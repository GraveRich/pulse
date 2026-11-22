// Pulse - lightweight music player (YouTube + SoundCloud official embedded players + local files).
// https://github.com/GraveRich/pulse
// Native host: a small WinForms window around the system WebView2 runtime, plus a
// localhost-only HTTP server that serves the UI, the local music library and a few
// SoundCloud helper lookups. Written in C# 5 so it builds with the csc.exe that ships
// with Windows (.NET Framework 4.8) - no SDK needed. See build.ps1.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Pulse
{
    static class App
    {
        public const string Version = "1.5.0";
        public static string DataDir, CacheDir, UiDir;
        public static bool Headless, Dev, Hidden, Mute, Minimized, NoActivate, RemoteLocal;
        public static string SelfTestOut;
        public static int Port;
        public static string Token;
        public static MainForm Form;
        public static volatile bool MediaKeysOn;
        public static int AdsBlocked;
        static readonly object logGate = new object();

        [STAThread]
        static int Main(string[] args)
        {
            string dataOverride = null;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--headless") Headless = true;
                else if (a == "--dev") Dev = true;
                else if (a == "--hidden") Hidden = true;
                else if (a == "--mute") Mute = true;
                else if (a == "--minimized") Minimized = true;
                else if (a == "--no-activate") NoActivate = true;
                else if (a == "--remote-local") RemoteLocal = true;
                else if (a == "--port" && i + 1 < args.Length) int.TryParse(args[++i], out Port);
                else if (a == "--token" && i + 1 < args.Length) Token = args[++i];
                else if (a == "--data" && i + 1 < args.Length) dataOverride = args[++i];
                else if (a == "--self-test" && i + 1 < args.Length) { SelfTestOut = args[++i]; Hidden = true; Mute = true; }
            }

            string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
            UiDir = Path.Combine(exeDir, "ui");
            if (dataOverride != null)
            {
                DataDir = Path.Combine(dataOverride, "data");
                CacheDir = Path.Combine(dataOverride, "cache");
            }
            else
            {
                DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Pulse");
                CacheDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pulse");
            }
            Directory.CreateDirectory(DataDir);
            Directory.CreateDirectory(CacheDir);
            Directory.CreateDirectory(Path.Combine(CacheDir, "art"));

            Mutex single = null;
            if (!Headless && dataOverride == null)
            {
                bool created;
                single = new Mutex(true, "Pulse.MusicPlayer.SingleInstance", out created);
                if (!created) { Native.FocusOtherInstance(); return 0; }
            }

            if (string.IsNullOrEmpty(Token))
            {
                byte[] b = new byte[16];
                using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(b);
                Token = BitConverter.ToString(b).Replace("-", "").ToLowerInvariant();
            }
            if (Port == 0)
            {
                var l = new TcpListener(IPAddress.Loopback, 0);
                l.Start();
                Port = ((IPEndPoint)l.LocalEndpoint).Port;
                l.Stop();
            }

            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            ServicePointManager.DefaultConnectionLimit = 12;

            Library.Init();
            Sc.Init();
            var server = new Server();
            try { server.Start(); }
            catch (Exception ex)
            {
                Log("server start failed: " + ex);
                if (!Headless) MessageBox.Show("Pulse could not start its local server.\n\n" + ex.Message, "Pulse");
                return 2;
            }
            Library.ScanAsync();

            if (Headless)
            {
                Thread.Sleep(Timeout.Infinite);
                return 0;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string url = "http://localhost:" + Port + "/?k=" + Token + (Mute ? "&mute=1" : "") + (SelfTestOut != null ? "&selftest=1" : "");
            Form = new MainForm(url);
            Application.Run(Form);
            Remote.Stop();
            Sc.Flush();
            if (single != null) GC.KeepAlive(single);
            return 0;
        }

        public static void Log(string s)
        {
            try
            {
                lock (logGate)
                {
                    string p = Path.Combine(CacheDir ?? Path.GetTempPath(), "log.txt");
                    if (File.Exists(p) && new FileInfo(p).Length > 512 * 1024) File.Delete(p);
                    File.AppendAllText(p, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + s + "\r\n");
                }
            }
            catch { }
        }
    }

    // ---------------------------------------------------------------- JSON helpers

    static class Json
    {
        public static string Str(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder(s.Length + 2);
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20 || c == 0x2028 || c == 0x2029 || (c >= 0xD800 && c <= 0xDFFF))
                            sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        public static JavaScriptSerializer Ser()
        {
            var s = new JavaScriptSerializer();
            s.MaxJsonLength = int.MaxValue;
            s.RecursionLimit = 64;
            return s;
        }

        public static Dictionary<string, object> Obj(string json)
        {
            try { return Ser().Deserialize<Dictionary<string, object>>(json) ?? new Dictionary<string, object>(); }
            catch { return new Dictionary<string, object>(); }
        }

        public static string Get(Dictionary<string, object> d, string key)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v) && v != null) return Convert.ToString(v);
            return null;
        }
    }

    // ---------------------------------------------------------------- local library

    class Track
    {
        public string id, path, title, artist, album;
        public int dur, track, year;
        public bool art;
        public long size, mtime;
    }

    static class Library
    {
        static readonly object gate = new object();
        static Dictionary<string, Track> byId = new Dictionary<string, Track>();
        static List<string> folders = new List<string>();
        static volatile bool scanning;
        static volatile bool rescanWanted;
        static int scanDone, scanTotal;
        static readonly string[] Exts = { ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".webm" };
        static readonly string[] Covers = { "cover.jpg", "folder.jpg", "front.jpg", "cover.png", "folder.png", "front.png", "cover.jpeg" };

        static string FoldersFile { get { return Path.Combine(App.DataDir, "folders.json"); } }
        static string CacheFile { get { return Path.Combine(App.CacheDir, "library.json"); } }

        public static void Init()
        {
            try
            {
                if (File.Exists(FoldersFile))
                {
                    var list = Json.Ser().Deserialize<List<string>>(File.ReadAllText(FoldersFile, Encoding.UTF8));
                    if (list != null) folders = list;
                }
                else
                {
                    string music = Environment.GetFolderPath(Environment.SpecialFolder.MyMusic);
                    if (!string.IsNullOrEmpty(music) && Directory.Exists(music)) folders.Add(music);
                    SaveFolders();
                }
            }
            catch (Exception ex) { App.Log("folders load: " + ex.Message); }
            try
            {
                if (File.Exists(CacheFile))
                {
                    var list = Json.Ser().Deserialize<List<Track>>(File.ReadAllText(CacheFile, Encoding.UTF8));
                    if (list != null) foreach (var t in list) if (t != null && t.id != null && t.path != null) byId[t.id] = t;
                }
            }
            catch (Exception ex) { App.Log("library cache load: " + ex.Message); }
        }

        static void SaveFolders()
        {
            try { File.WriteAllText(FoldersFile, Json.Ser().Serialize(folders), Encoding.UTF8); }
            catch (Exception ex) { App.Log("folders save: " + ex.Message); }
        }

        public static string Id(string path)
        {
            using (var sha = SHA1.Create())
            {
                byte[] h = sha.ComputeHash(Encoding.UTF8.GetBytes(path.ToLowerInvariant()));
                return BitConverter.ToString(h, 0, 8).Replace("-", "").ToLowerInvariant();
            }
        }

        public static Track Find(string id)
        {
            lock (gate) { Track t; return byId.TryGetValue(id, out t) ? t : null; }
        }

        public static bool AddFolder(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return false;
            try { path = Path.GetFullPath(path).TrimEnd('\\'); } catch { return false; }
            if (path.Length == 2 && path[1] == ':') path += "\\";
            if (!Directory.Exists(path)) return false;
            lock (gate)
            {
                if (!folders.Any(f => string.Equals(f, path, StringComparison.OrdinalIgnoreCase))) folders.Add(path);
                SaveFolders();
            }
            ScanAsync();
            return true;
        }

        public static void RemoveFolder(string path)
        {
            lock (gate)
            {
                folders.RemoveAll(f => string.Equals(f, path, StringComparison.OrdinalIgnoreCase));
                SaveFolders();
            }
            ScanAsync();
        }

        public static void ScanAsync()
        {
            lock (gate)
            {
                if (scanning) { rescanWanted = true; return; }
                scanning = true;
                scanDone = 0; scanTotal = 0;
            }
            var th = new Thread(ScanLoop);
            th.IsBackground = true;
            th.Priority = ThreadPriority.BelowNormal;
            th.Start();
        }

        static void ScanLoop()
        {
            while (true)
            {
                try { ScanOnce(); } catch (Exception ex) { App.Log("scan: " + ex); }
                lock (gate)
                {
                    if (rescanWanted) { rescanWanted = false; scanDone = 0; scanTotal = 0; continue; }
                    scanning = false;
                    return;
                }
            }
        }

        static void Walk(string dir, List<string> files, int depth)
        {
            if (depth > 12) return;
            try
            {
                foreach (string f in Directory.GetFiles(dir))
                {
                    string ext = Path.GetExtension(f).ToLowerInvariant();
                    if (Array.IndexOf(Exts, ext) >= 0) files.Add(f);
                }
                foreach (string d in Directory.GetDirectories(dir))
                {
                    try
                    {
                        var attr = File.GetAttributes(d);
                        if ((attr & FileAttributes.ReparsePoint) != 0 || (attr & FileAttributes.System) != 0) continue;
                    }
                    catch { continue; }
                    Walk(d, files, depth + 1);
                }
            }
            catch { }
        }

        static void ScanOnce()
        {
            List<string> roots;
            Dictionary<string, Track> old;
            lock (gate) { roots = new List<string>(folders); old = new Dictionary<string, Track>(byId); }
            var files = new List<string>();
            foreach (string r in roots) if (Directory.Exists(r)) Walk(r, files, 0);
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            files = files.Where(f => seen.Add(f)).ToList();
            scanTotal = files.Count;
            var next = new Dictionary<string, Track>();
            bool changed = files.Count != old.Count;
            foreach (string f in files)
            {
                try
                {
                    var fi = new FileInfo(f);
                    string id = Id(f);
                    Track t;
                    if (old.TryGetValue(id, out t) && t.size == fi.Length && t.mtime == fi.LastWriteTimeUtc.Ticks && t.path == f)
                    {
                        next[id] = t;
                    }
                    else
                    {
                        t = ReadTags(f, fi, id);
                        next[id] = t;
                        changed = true;
                        // publish progressively so the UI fills in during a long first scan
                        lock (gate) { byId[id] = t; }
                    }
                }
                catch (Exception ex) { App.Log("scan file " + f + ": " + ex.Message); }
                scanDone++;
            }
            lock (gate) { byId = next; }
            if (changed)
            {
                try { File.WriteAllText(CacheFile, Json.Ser().Serialize(next.Values.ToList()), Encoding.UTF8); }
                catch (Exception ex) { App.Log("library cache save: " + ex.Message); }
            }
        }

        static Track ReadTags(string path, FileInfo fi, string id)
        {
            var t = new Track();
            t.id = id; t.path = path; t.size = fi.Length; t.mtime = fi.LastWriteTimeUtc.Ticks;
            try
            {
                using (var f = TagLib.File.Create(path))
                {
                    t.title = Clean(f.Tag.Title);
                    t.artist = Clean(f.Tag.JoinedPerformers);
                    if (t.artist == null) t.artist = Clean(f.Tag.JoinedAlbumArtists);
                    t.album = Clean(f.Tag.Album);
                    t.track = (int)f.Tag.Track;
                    t.year = (int)f.Tag.Year;
                    if (f.Properties != null) t.dur = (int)Math.Round(f.Properties.Duration.TotalSeconds);
                    t.art = f.Tag.Pictures != null && f.Tag.Pictures.Length > 0;
                }
            }
            catch { }
            if (t.title == null)
            {
                string name = Path.GetFileNameWithoutExtension(path);
                int k = name.IndexOf(" - ", StringComparison.Ordinal);
                if (k > 0 && t.artist == null) { t.artist = name.Substring(0, k).Trim(); t.title = name.Substring(k + 3).Trim(); }
                else t.title = name;
            }
            if (!t.art) t.art = FolderCover(path) != null;
            return t;
        }

        static string Clean(string s)
        {
            if (s == null) return null;
            s = s.Replace("\0", "").Trim();
            return s.Length == 0 ? null : s;
        }

        static string FolderCover(string trackPath)
        {
            try
            {
                string dir = Path.GetDirectoryName(trackPath);
                foreach (string c in Covers)
                {
                    string p = Path.Combine(dir, c);
                    if (File.Exists(p)) return p;
                }
            }
            catch { }
            return null;
        }

        public static string ArtFile(Track t)
        {
            string cache = Path.Combine(App.CacheDir, "art", t.id + "_" + (t.mtime & 0xFFFFFFF).ToString("x") + ".jpg");
            if (File.Exists(cache)) return cache;
            byte[] raw = null;
            try
            {
                using (var f = TagLib.File.Create(t.path))
                {
                    var pics = f.Tag.Pictures;
                    if (pics != null && pics.Length > 0) raw = pics[0].Data.Data;
                }
            }
            catch { }
            if (raw == null)
            {
                string fc = FolderCover(t.path);
                if (fc != null) { try { raw = File.ReadAllBytes(fc); } catch { } }
            }
            if (raw == null || raw.Length == 0) return null;
            try
            {
                using (var ms = new MemoryStream(raw))
                using (var img = Image.FromStream(ms))
                {
                    const int max = 320;
                    double sc = Math.Min(1.0, (double)max / Math.Max(img.Width, img.Height));
                    int w = Math.Max(1, (int)Math.Round(img.Width * sc)), h = Math.Max(1, (int)Math.Round(img.Height * sc));
                    using (var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb))
                    {
                        using (var g = Graphics.FromImage(bmp))
                        {
                            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                            g.DrawImage(img, 0, 0, w, h);
                        }
                        var enc = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
                        var ep = new EncoderParameters(1);
                        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 86L);
                        bmp.Save(cache, enc, ep);
                    }
                }
                return cache;
            }
            catch (Exception ex) { App.Log("art " + t.path + ": " + ex.Message); return null; }
        }

        public static string ToJson()
        {
            List<Track> list; List<string> fl;
            lock (gate) { list = byId.Values.ToList(); fl = new List<string>(folders); }
            var sb = new StringBuilder(list.Count * 120 + 256);
            sb.Append("{\"scanning\":").Append(scanning ? "true" : "false");
            sb.Append(",\"done\":").Append(scanDone).Append(",\"total\":").Append(scanTotal);
            sb.Append(",\"folders\":[");
            for (int i = 0; i < fl.Count; i++) { if (i > 0) sb.Append(','); sb.Append(Json.Str(fl[i])); }
            sb.Append("],\"tracks\":[");
            bool first = true;
            foreach (var t in list)
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"id\":").Append(Json.Str(t.id));
                sb.Append(",\"title\":").Append(Json.Str(t.title));
                sb.Append(",\"artist\":").Append(Json.Str(t.artist));
                sb.Append(",\"album\":").Append(Json.Str(t.album));
                sb.Append(",\"dur\":").Append(t.dur);
                sb.Append(",\"track\":").Append(t.track);
                sb.Append(",\"year\":").Append(t.year);
                sb.Append(",\"art\":").Append(t.art ? "true" : "false").Append('}');
            }
            sb.Append("]}");
            return sb.ToString();
        }
    }

    // ---------------------------------------------------------------- SoundCloud helpers
    // Only public pages and the official oEmbed endpoint are used. Playback itself happens
    // in SoundCloud's official embedded player inside the UI; nothing is downloaded here.

    static class Sc
    {
        const string UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
        static readonly SemaphoreSlim slots = new SemaphoreSlim(4);
        static readonly object gate = new object();
        static Dictionary<string, string> oembed = new Dictionary<string, string>();
        static readonly Dictionary<string, KeyValuePair<DateTime, string>> searches = new Dictionary<string, KeyValuePair<DateTime, string>>();
        static bool dirty;
        static System.Threading.Timer timer;

        static string CacheFile { get { return Path.Combine(App.CacheDir, "oembed.json"); } }

        public static void Init()
        {
            try
            {
                if (File.Exists(CacheFile))
                {
                    var d = Json.Ser().Deserialize<Dictionary<string, string>>(File.ReadAllText(CacheFile, Encoding.UTF8));
                    if (d != null) oembed = d;
                }
            }
            catch { }
            timer = new System.Threading.Timer(delegate { Flush(); }, null, 15000, 15000);
        }

        public static void Flush()
        {
            try
            {
                string json = null;
                lock (gate)
                {
                    if (!dirty) return;
                    dirty = false;
                    if (oembed.Count > 6000) oembed = oembed.Skip(oembed.Count - 4000).ToDictionary(p => p.Key, p => p.Value);
                    json = Json.Ser().Serialize(oembed);
                }
                File.WriteAllText(CacheFile, json, Encoding.UTF8);
            }
            catch (Exception ex) { App.Log("oembed save: " + ex.Message); }
        }

        public static bool IsScUrl(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return false;
            if (u.Scheme != "https") return false;
            string h = u.Host.ToLowerInvariant();
            return h == "soundcloud.com" || h == "www.soundcloud.com" || h == "m.soundcloud.com" || h == "on.soundcloud.com" || h == "api.soundcloud.com";
        }

        static string Fetch(string url, out string finalUrl)
        {
            finalUrl = url;
            slots.Wait();
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.UserAgent = UA;
                req.Accept = "text/html,application/json;q=0.9,*/*;q=0.8";
                req.Headers["Accept-Language"] = "en-US,en;q=0.9";
                req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
                req.Timeout = 12000;
                req.ReadWriteTimeout = 12000;
                req.AllowAutoRedirect = true;
                req.MaximumAutomaticRedirections = 5;
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    finalUrl = res.ResponseUri.ToString();
                    using (var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                        return sr.ReadToEnd();
                }
            }
            finally { slots.Release(); }
        }

        public static string Search(string q, string type)
        {
            if (type != "sets" && type != "people") type = "sounds";
            string key = type + "|" + q.Trim().ToLowerInvariant();
            lock (gate)
            {
                KeyValuePair<DateTime, string> c;
                if (searches.TryGetValue(key, out c) && (DateTime.UtcNow - c.Key).TotalMinutes < 15) return c.Value;
            }
            string fin;
            string html = Fetch("https://soundcloud.com/search/" + type + "?q=" + Uri.EscapeDataString(q.Trim()), out fin);
            var sb = new StringBuilder("{\"results\":[");
            int n = 0;
            foreach (Match m in Regex.Matches(html, "<li><h2><a href=\"(/[^\"]+)\">(.*?)</a></h2></li>", RegexOptions.Singleline))
            {
                string href = m.Groups[1].Value;
                if (href.StartsWith("/search")) continue;
                string title = WebUtility.HtmlDecode(m.Groups[2].Value).Trim();
                if (n++ > 0) sb.Append(',');
                sb.Append("{\"url\":").Append(Json.Str("https://soundcloud.com" + href)).Append(",\"title\":").Append(Json.Str(title)).Append('}');
            }
            sb.Append("]}");
            string json = sb.ToString();
            lock (gate)
            {
                if (searches.Count > 200) searches.Clear();
                searches[key] = new KeyValuePair<DateTime, string>(DateTime.UtcNow, json);
            }
            return json;
        }

        // Returns {url,title,author,authorUrl,thumb,kind,id} or null when SoundCloud has nothing for it.
        public static string OEmbed(string url)
        {
            lock (gate) { string c; if (oembed.TryGetValue(url, out c)) return c; }
            string fin, body;
            try { body = Fetch("https://soundcloud.com/oembed?format=json&url=" + Uri.EscapeDataString(url), out fin); }
            catch (WebException ex)
            {
                var r = ex.Response as HttpWebResponse;
                if (r != null && ((int)r.StatusCode == 404 || (int)r.StatusCode == 403))
                {
                    lock (gate) { oembed[url] = "null"; dirty = true; }
                    return "null";
                }
                throw;
            }
            var d = Json.Obj(body);
            string title = Json.Get(d, "title") ?? "";
            string author = Json.Get(d, "author_name") ?? "";
            if (author.Length > 0 && title.EndsWith(" by " + author, StringComparison.Ordinal))
                title = title.Substring(0, title.Length - author.Length - 4);
            string kind = "track", id = null;
            var m = Regex.Match(Json.Get(d, "html") ?? "", "api\\.soundcloud\\.com%2F(tracks|playlists|users)%2F(\\d+)");
            if (m.Success)
            {
                kind = m.Groups[1].Value == "tracks" ? "track" : (m.Groups[1].Value == "playlists" ? "set" : "artist");
                id = m.Groups[2].Value;
            }
            string json = "{\"url\":" + Json.Str(url) + ",\"title\":" + Json.Str(title) + ",\"author\":" + Json.Str(author)
                + ",\"authorUrl\":" + Json.Str(Json.Get(d, "author_url")) + ",\"thumb\":" + Json.Str(Json.Get(d, "thumbnail_url"))
                + ",\"kind\":" + Json.Str(kind) + ",\"id\":" + (id ?? "null") + "}";
            lock (gate) { oembed[url] = json; dirty = true; }
            return json;
        }

        // Follows on.soundcloud.com short links to the real page.
        public static string Resolve(string url)
        {
            string fin;
            Fetch(url, out fin);
            int q = fin.IndexOf('?');
            if (q > 0) fin = fin.Substring(0, q);
            return IsScUrl(fin) ? fin : url;
        }
    }

    // ---------------------------------------------------------------- YouTube lookups
    // Search reads YouTube's public results page; videos themselves play in YouTube's official
    // embedded player inside the UI. Nothing is downloaded here.

    static class Yt
    {
        const string UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
        static readonly object gate = new object();
        static readonly Dictionary<string, KeyValuePair<DateTime, string>> cache = new Dictionary<string, KeyValuePair<DateTime, string>>();

        public static bool IsId(string id) { return id != null && Regex.IsMatch(id, "^[A-Za-z0-9_-]{11}$"); }
        public static bool IsWatchUrl(string url) { return url != null && Regex.IsMatch(url, "^https://www\\.youtube\\.com/watch\\?v=[A-Za-z0-9_-]{11}$"); }

        static string Fetch(string url)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = UA;
            req.Accept = "text/html,application/json;q=0.9,*/*;q=0.8";
            req.Headers["Accept-Language"] = "en-US,en;q=0.9";
            req.Headers["Cookie"] = "SOCS=CAI; CONSENT=YES+1"; // "reject all" on the cookie wall
            req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            req.Timeout = 12000;
            req.ReadWriteTimeout = 12000;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                return sr.ReadToEnd();
        }

        static bool Cached(string key, out string json)
        {
            lock (gate)
            {
                KeyValuePair<DateTime, string> c;
                if (cache.TryGetValue(key, out c) && (DateTime.UtcNow - c.Key).TotalMinutes < 30) { json = c.Value; return true; }
            }
            json = null;
            return false;
        }

        static void Store(string key, string json)
        {
            lock (gate)
            {
                if (cache.Count > 300) cache.Clear();
                cache[key] = new KeyValuePair<DateTime, string>(DateTime.UtcNow, json);
            }
        }

        static void Walk(object o, List<Dictionary<string, object>> found, int depth)
        {
            if (o == null || depth > 80 || found.Count >= 40) return;
            var d = o as Dictionary<string, object>;
            if (d != null)
            {
                object v;
                if (d.TryGetValue("videoRenderer", out v) && v is Dictionary<string, object>) { found.Add((Dictionary<string, object>)v); return; }
                foreach (var x in d.Values) Walk(x, found, depth + 1);
                return;
            }
            if (o is string) return;
            var e = o as System.Collections.IEnumerable;
            if (e != null) foreach (var x in e) Walk(x, found, depth + 1);
        }

        // {"simpleText":".."} or {"runs":[{"text":".."}]}
        static string Text(Dictionary<string, object> d, string key)
        {
            object v;
            if (!d.TryGetValue(key, out v)) return "";
            var t = v as Dictionary<string, object>;
            if (t == null) return "";
            object st;
            if (t.TryGetValue("simpleText", out st) && st != null) return st.ToString();
            object runs;
            if (!t.TryGetValue("runs", out runs)) return "";
            var e = runs as System.Collections.IEnumerable;
            if (e == null) return "";
            var sb = new StringBuilder();
            foreach (var r in e)
            {
                var rd = r as Dictionary<string, object>;
                object tx;
                if (rd != null && rd.TryGetValue("text", out tx) && tx != null) sb.Append(tx.ToString());
            }
            return sb.ToString();
        }

        static long DurMs(string s)
        {
            long total = 0;
            foreach (string part in s.Split(':'))
            {
                int n;
                if (!int.TryParse(part.Trim(), out n)) return 0;
                total = total * 60 + n;
            }
            return total * 1000;
        }

        static string Artist(string owner)
        {
            owner = (owner ?? "").Trim();
            if (owner.EndsWith(" - Topic", StringComparison.Ordinal)) owner = owner.Substring(0, owner.Length - 8);
            else if (owner.Length > 4 && owner.EndsWith("VEVO", StringComparison.Ordinal)) owner = owner.Substring(0, owner.Length - 4);
            return owner.Trim();
        }

        // {"results":[{"id","title","artist","dur"}]} - videos only, live streams left out
        public static string Search(string q)
        {
            string key = "s|" + q.Trim().ToLowerInvariant();
            string json;
            if (Cached(key, out json)) return json;
            string html = Fetch("https://www.youtube.com/results?search_query=" + Uri.EscapeDataString(q.Trim()) + "&sp=EgIQAQ%3D%3D");
            var m = Regex.Match(html, "var ytInitialData = (\\{.*?\\});</script>", RegexOptions.Singleline);
            if (!m.Success) throw new Exception("YouTube search page had no results block");
            var ser = new JavaScriptSerializer();
            ser.MaxJsonLength = int.MaxValue;
            ser.RecursionLimit = 400;
            var found = new List<Dictionary<string, object>>();
            Walk(ser.DeserializeObject(m.Groups[1].Value), found, 0);
            var sb = new StringBuilder("{\"results\":[");
            var seen = new HashSet<string>();
            int n = 0;
            foreach (var v in found)
            {
                object idObj;
                if (!v.TryGetValue("videoId", out idObj) || idObj == null) continue;
                string id = idObj.ToString();
                if (!IsId(id) || !seen.Add(id)) continue;
                long dur = DurMs(Text(v, "lengthText"));
                if (dur <= 0) continue;
                string title = Text(v, "title");
                if (title.Length == 0) continue;
                if (n++ > 0) sb.Append(',');
                sb.Append("{\"id\":").Append(Json.Str(id)).Append(",\"title\":").Append(Json.Str(title))
                  .Append(",\"artist\":").Append(Json.Str(Artist(Text(v, "ownerText")))).Append(",\"dur\":").Append(dur).Append('}');
            }
            sb.Append("]}");
            json = sb.ToString();
            if (n > 0) Store(key, json);
            return json;
        }

        // {"id","title","artist"} from the official oEmbed endpoint, or null when YouTube has nothing for the id
        public static string Info(string id)
        {
            string key = "i|" + id;
            string json;
            if (Cached(key, out json)) return json;
            string body;
            try { body = Fetch("https://www.youtube.com/oembed?format=json&url=" + Uri.EscapeDataString("https://www.youtube.com/watch?v=" + id)); }
            catch (WebException ex)
            {
                var r = ex.Response as HttpWebResponse;
                if (r != null && (int)r.StatusCode >= 400 && (int)r.StatusCode < 500) { Store(key, "null"); return "null"; }
                throw;
            }
            var d = Json.Obj(body);
            json = "{\"id\":" + Json.Str(id) + ",\"title\":" + Json.Str(Json.Get(d, "title") ?? "") + ",\"artist\":" + Json.Str(Artist(Json.Get(d, "author_name"))) + "}";
            Store(key, json);
            return json;
        }
    }

    // ---------------------------------------------------------------- phone remote
    // Optional (Settings > Phone remote). A tiny HTTP server on the home network that serves one control page
    // (ui\remote.html) and a handful of commands. It never exposes the library, files or settings. A phone pairs
    // once with the 6-digit code shown in Pulse and gets a long key; every other request needs that key.
    // Plain TcpListener, because HttpListener needs admin rights to listen on anything but localhost.

    static class Remote
    {
        static readonly object gate = new object();
        static TcpListener listener;
        static volatile bool running;
        static string state = "null";
        static long version;
        static DateTime stateAt = DateTime.UtcNow;
        static string code;
        static List<string> keys = new List<string>();
        static int port;
        static string error;
        static int fails;
        static DateTime lockUntil = DateTime.MinValue;
        static bool loaded;

        static string StoreFile { get { return Path.Combine(App.DataDir, "remote.json"); } }

        static string RandomHex(int bytes)
        {
            var b = new byte[bytes];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant();
        }

        static string NewCode()
        {
            var b = new byte[4];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            return (BitConverter.ToUInt32(b, 0) % 1000000).ToString("D6");
        }

        static void Load()
        {
            if (loaded) return;
            loaded = true;
            try
            {
                if (File.Exists(StoreFile))
                {
                    var d = Json.Obj(File.ReadAllText(StoreFile, Encoding.UTF8));
                    string c = Json.Get(d, "code");
                    if (c != null && Regex.IsMatch(c, "^\\d{6}$")) code = c;
                    int pt;
                    if (int.TryParse(Json.Get(d, "port") ?? "", out pt) && pt > 1024 && pt < 65000) port = pt;
                    object k;
                    if (d.TryGetValue("keys", out k) && k is System.Collections.IEnumerable && !(k is string))
                        foreach (var x in (System.Collections.IEnumerable)k)
                            if (x != null && Regex.IsMatch(x.ToString(), "^[0-9a-f]{32}$")) keys.Add(x.ToString());
                }
            }
            catch (Exception ex) { App.Log("remote load: " + ex.Message); }
            if (code == null) code = NewCode();
            if (port == 0) port = 4587;
        }

        static void Save()
        {
            try
            {
                string json = "{\"port\":" + port + ",\"code\":" + Json.Str(code) + ",\"keys\":[" + string.Join(",", keys.Select(k => Json.Str(k))) + "]}";
                File.WriteAllText(StoreFile, json, new UTF8Encoding(false));
            }
            catch (Exception ex) { App.Log("remote save: " + ex.Message); }
        }

        public static void Start()
        {
            lock (gate)
            {
                if (running) return;
                Load();
                error = null;
                // hidden test runs never open a port on the network (that would raise a Windows Firewall prompt)
                var addr = (App.RemoteLocal || App.Hidden) ? IPAddress.Loopback : IPAddress.Any;
                TcpListener l = null;
                for (int i = 0; i < 20 && l == null; i++)
                {
                    try { var t = new TcpListener(addr, port + i); t.Start(16); l = t; port = port + i; }
                    catch (SocketException) { }
                }
                if (l == null) { error = "No free port between " + port + " and " + (port + 19) + "."; App.Log("remote: " + error); return; }
                listener = l;
                running = true;
                Save();
                var th = new Thread(AcceptLoop);
                th.IsBackground = true;
                th.Name = "remote";
                th.Start(l);
            }
        }

        public static void Stop()
        {
            lock (gate)
            {
                if (!running) return;
                running = false;
                try { listener.Stop(); } catch { }
                listener = null;
                Monitor.PulseAll(gate);
            }
        }

        // New pairing code, and every phone paired so far has to pair again.
        public static void Forget()
        {
            lock (gate)
            {
                Load();
                keys.Clear();
                code = NewCode();
                fails = 0;
                lockUntil = DateTime.MinValue;
                Save();
                Monitor.PulseAll(gate);
            }
        }

        public static void SetState(string json)
        {
            lock (gate)
            {
                state = json;
                version++;
                stateAt = DateTime.UtcNow;
                Monitor.PulseAll(gate);
            }
        }

        static List<string> LocalIps()
        {
            var first = new List<string>();
            var rest = new List<string>();
            try
            {
                foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                    var ipp = ni.GetIPProperties();
                    bool gw = ipp.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
                    foreach (var ua in ipp.UnicastAddresses)
                    {
                        if (ua.Address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(ua.Address)) continue;
                        string ip = ua.Address.ToString();
                        if (ip.StartsWith("169.254.")) continue;
                        (gw ? first : rest).Add(ip);
                    }
                }
            }
            catch { }
            first.AddRange(rest);
            if (App.RemoteLocal) first.Insert(0, "127.0.0.1");
            return first;
        }

        public static string Info()
        {
            lock (gate)
            {
                Load();
                return "{\"on\":" + (running ? "true" : "false") + ",\"port\":" + port + ",\"code\":" + Json.Str(code)
                    + ",\"phones\":" + keys.Count + ",\"error\":" + (error == null ? "null" : Json.Str(error))
                    + ",\"ips\":[" + string.Join(",", LocalIps().Select(x => Json.Str(x))) + "]}";
            }
        }

        static void AcceptLoop(object o)
        {
            var l = (TcpListener)o;
            while (running)
            {
                TcpClient c;
                try { c = l.AcceptTcpClient(); }
                catch { break; }
                ThreadPool.QueueUserWorkItem(delegate { try { Serve(c); } catch { } finally { try { c.Close(); } catch { } } });
            }
        }

        static void Write(Stream s, int status, string type, byte[] body, string cache = "no-store")
        {
            string reason = status == 200 ? "OK" : status == 401 ? "Unauthorized" : status == 403 ? "Forbidden" : status == 404 ? "Not Found" : status == 429 ? "Too Many Requests" : "Error";
            byte[] head = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length
                + "\r\nCache-Control: " + cache + "\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n");
            s.Write(head, 0, head.Length);
            if (body.Length > 0) s.Write(body, 0, body.Length);
            s.Flush();
        }

        static void WriteJson(Stream s, string json, int status = 200) { Write(s, status, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json)); }

        static void Serve(TcpClient client)
        {
            client.ReceiveTimeout = 8000;
            client.SendTimeout = 8000;
            client.NoDelay = true;
            var s = client.GetStream();
            var buf = new byte[40000];
            int n = 0, headEnd = -1;
            while (headEnd < 0)
            {
                if (n >= buf.Length) return;
                int r = s.Read(buf, n, buf.Length - n);
                if (r <= 0) return;
                n += r;
                for (int i = Math.Max(0, n - r - 3); i + 3 < n; i++)
                    if (buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10) { headEnd = i; break; }
            }
            string[] lines = Encoding.ASCII.GetString(buf, 0, headEnd).Split(new[] { "\r\n" }, StringSplitOptions.None);
            string[] rl = lines[0].Split(' ');
            if (rl.Length < 2) return;
            string method = rl[0], target = rl[1];
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 1; i < lines.Length; i++)
            {
                int c = lines[i].IndexOf(':');
                if (c > 0) headers[lines[i].Substring(0, c).Trim()] = lines[i].Substring(c + 1).Trim();
            }
            int len = 0;
            string cl;
            if (headers.TryGetValue("Content-Length", out cl)) int.TryParse(cl, out len);
            int bodyStart = headEnd + 4;
            if (len < 0 || len > buf.Length - bodyStart) { WriteJson(s, "{\"error\":\"too large\"}", 413); return; }
            while (n - bodyStart < len)
            {
                int r = s.Read(buf, n, buf.Length - n);
                if (r <= 0) return;
                n += r;
            }
            string body = Encoding.UTF8.GetString(buf, bodyStart, len);

            string path = target, query = "";
            int qi = target.IndexOf('?');
            if (qi >= 0) { path = target.Substring(0, qi); query = target.Substring(qi + 1); }
            var q = new Dictionary<string, string>();
            foreach (string part in query.Split(new[] { '&' }, StringSplitOptions.RemoveEmptyEntries))
            {
                int e = part.IndexOf('=');
                try { q[Uri.UnescapeDataString(e < 0 ? part : part.Substring(0, e))] = e < 0 ? "" : Uri.UnescapeDataString(part.Substring(e + 1).Replace('+', ' ')); } catch { }
            }
            bool get = method == "GET", post = method == "POST";

            // ---- open to anyone on the network: the page itself and pairing
            if (get && (path == "/" || path == "/index.html"))
            {
                Write(s, 200, "text/html; charset=utf-8", File.ReadAllBytes(Path.Combine(App.UiDir, "remote.html")), "no-cache");
                return;
            }
            if (get && path == "/icon.png") { Write(s, 200, "image/png", File.ReadAllBytes(Path.Combine(App.UiDir, "icon.png")), "max-age=86400"); return; }
            if (get && path == "/manifest.json")
            {
                WriteJson(s, "{\"name\":\"Pulse remote\",\"short_name\":\"Pulse\",\"start_url\":\"/\",\"display\":\"standalone\",\"background_color\":\"#0a0a0d\",\"theme_color\":\"#0a0a0d\",\"icons\":[{\"src\":\"/icon.png\",\"sizes\":\"256x256\",\"type\":\"image/png\"}]}");
                return;
            }
            if (post && path == "/pair")
            {
                string given = null;
                try { given = Json.Get(Json.Obj(body), "code"); } catch { }
                string key = null;
                bool locked;
                lock (gate)
                {
                    locked = DateTime.UtcNow < lockUntil;
                    if (!locked && given != null && given == code)
                    {
                        key = RandomHex(16);
                        keys.Add(key);
                        if (keys.Count > 20) keys.RemoveAt(0);
                        fails = 0;
                        Save();
                    }
                    else if (!locked && ++fails >= 8) { fails = 0; lockUntil = DateTime.UtcNow.AddMinutes(5); }
                }
                if (key != null)
                {
                    WriteJson(s, "{\"key\":" + Json.Str(key) + "}");
                    if (App.Form != null) App.Form.PostToPage("remote:info:" + Info());
                }
                else if (locked) WriteJson(s, "{\"error\":\"Too many wrong codes. Try again in 5 minutes.\"}", 429);
                else WriteJson(s, "{\"error\":\"Wrong code\"}", 403);
                return;
            }

            // ---- everything else needs the key this phone got when it paired
            string k = null;
            if (!headers.TryGetValue("X-Key", out k)) q.TryGetValue("key", out k);
            bool ok;
            lock (gate) ok = k != null && keys.Contains(k);
            if (!ok) { WriteJson(s, "{\"error\":\"not paired\"}", 401); return; }

            if (get && path == "/state")
            {
                long have = -1;
                string hv;
                if (q.TryGetValue("v", out hv)) long.TryParse(hv, out have);
                string json;
                lock (gate)
                {
                    if (have == version && running) Monitor.Wait(gate, 25000);
                    json = "{\"v\":" + version + ",\"age\":" + (long)(DateTime.UtcNow - stateAt).TotalMilliseconds + ",\"s\":" + state + "}";
                }
                WriteJson(s, json);
                return;
            }
            if (post && path == "/cmd")
            {
                string b = body.Trim();
                if (b.Length < 2 || b[0] != '{' || App.Form == null) { WriteJson(s, "{\"error\":\"bad command\"}", 400); return; }
                App.Form.PostToPage("rc:" + b);
                WriteJson(s, "{\"ok\":true}");
                return;
            }
            if (get && path == "/search")
            {
                string term;
                if (!q.TryGetValue("q", out term) || term.Trim().Length == 0) { WriteJson(s, "{\"results\":[]}"); return; }
                if (term.Length > 200) term = term.Substring(0, 200);
                try { WriteJson(s, Yt.Search(term)); }
                catch (Exception ex) { App.Log("remote search: " + ex.Message); WriteJson(s, "{\"error\":\"search failed\"}", 502); }
                return;
            }
            if (get && path.StartsWith("/art/"))
            {
                var t = Library.Find(path.Substring(5));
                string file = t == null ? null : Library.ArtFile(t);
                if (file == null) { Write(s, 404, "text/plain", new byte[0]); return; }
                Write(s, 200, "image/jpeg", File.ReadAllBytes(file), "max-age=86400");
                return;
            }
            WriteJson(s, "{\"error\":\"unknown\"}", 404);
        }
    }

    // ---------------------------------------------------------------- local HTTP server

    class Server
    {
        HttpListener listener;
        static readonly object stateGate = new object();

        static string StateFile { get { return Path.Combine(App.DataDir, "state.json"); } }

        public void Start()
        {
            listener = new HttpListener();
            listener.Prefixes.Add("http://localhost:" + App.Port + "/");
            listener.Start();
            var th = new Thread(Loop);
            th.IsBackground = true;
            th.Start();
        }

        void Loop()
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); }
                catch { break; }
                ThreadPool.QueueUserWorkItem(delegate(object o) { Handle((HttpListenerContext)o); }, ctx);
            }
        }

        static void Send(HttpListenerResponse res, int status, string contentType, byte[] body)
        {
            res.StatusCode = status;
            res.ContentType = contentType;
            res.ContentLength64 = body.Length;
            res.OutputStream.Write(body, 0, body.Length);
        }

        static void SendJson(HttpListenerResponse res, string json, int status = 200)
        {
            res.Headers["Cache-Control"] = "no-store";
            Send(res, status, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
        }

        static void Fail(HttpListenerResponse res, int status, string msg)
        {
            SendJson(res, "{\"error\":" + Json.Str(msg) + "}", status);
        }

        void Handle(HttpListenerContext ctx)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            try
            {
                res.Headers["X-Content-Type-Options"] = "nosniff";
                string origin = req.Headers["Origin"];
                if (!string.IsNullOrEmpty(origin) && origin != "http://localhost:" + App.Port)
                {
                    Fail(res, 403, "forbidden");
                    return;
                }
                string path = Uri.UnescapeDataString(req.Url.AbsolutePath);
                if (path.StartsWith("/api/") || path.StartsWith("/media/") || path.StartsWith("/art/"))
                {
                    string k = req.Headers["X-Pulse-Token"] ?? req.QueryString["k"];
                    if (k != App.Token) { Fail(res, 401, "unauthorized"); return; }
                    if (path.StartsWith("/media/")) Media(req, res, path.Substring(7));
                    else if (path.StartsWith("/art/")) Art(res, path.Substring(5));
                    else Api(req, res, path.Substring(5));
                }
                else Static(res, path);
            }
            catch (HttpListenerException) { }
            catch (IOException) { }
            catch (Exception ex)
            {
                App.Log(req.Url.AbsolutePath + ": " + ex);
                try { Fail(res, 500, ex.Message); } catch { }
            }
            finally
            {
                try { res.Close(); } catch { }
            }
        }

        static string Mime(string ext)
        {
            switch (ext)
            {
                case ".html": return "text/html; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".js": return "text/javascript; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".jpg": case ".jpeg": return "image/jpeg";
                case ".ico": return "image/x-icon";
                case ".ttf": return "font/ttf";
                case ".woff2": return "font/woff2";
                case ".mp3": return "audio/mpeg";
                case ".flac": return "audio/flac";
                case ".m4a": case ".aac": return "audio/mp4";
                case ".ogg": case ".oga": case ".opus": return "audio/ogg";
                case ".wav": return "audio/wav";
                case ".webm": return "audio/webm";
                default: return "application/octet-stream";
            }
        }

        void Static(HttpListenerResponse res, string path)
        {
            if (path == "/" || path == "") path = "/index.html";
            string rel = path.TrimStart('/').Replace('/', '\\');
            string full = Path.GetFullPath(Path.Combine(App.UiDir, rel));
            string root = Path.GetFullPath(App.UiDir).TrimEnd('\\') + "\\";
            if (!full.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
            {
                Send(res, 404, "text/plain", Encoding.UTF8.GetBytes("not found"));
                return;
            }
            string ext = Path.GetExtension(full).ToLowerInvariant();
            res.Headers["Cache-Control"] = ext == ".ttf" ? "max-age=604800" : "no-cache";
            Send(res, 200, Mime(ext), File.ReadAllBytes(full));
        }

        void Media(HttpListenerRequest req, HttpListenerResponse res, string id)
        {
            var t = Library.Find(id);
            if (t == null || !File.Exists(t.path)) { Fail(res, 404, "not found"); return; }
            using (var fs = new FileStream(t.path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 64 * 1024, FileOptions.SequentialScan))
            {
                long len = fs.Length, start = 0, end = len - 1;
                bool partial = false;
                string range = req.Headers["Range"];
                if (range != null && range.StartsWith("bytes="))
                {
                    string[] p = range.Substring(6).Split(',')[0].Split('-');
                    long a, b;
                    if (p.Length == 2)
                    {
                        if (p[0].Length == 0 && long.TryParse(p[1], out b)) { start = Math.Max(0, len - b); partial = true; }
                        else if (long.TryParse(p[0], out a))
                        {
                            start = a; partial = true;
                            if (p[1].Length > 0 && long.TryParse(p[1], out b)) end = Math.Min(b, len - 1);
                        }
                    }
                    if (start > end || start >= len)
                    {
                        res.StatusCode = 416;
                        res.Headers["Content-Range"] = "bytes */" + len;
                        return;
                    }
                }
                res.StatusCode = partial ? 206 : 200;
                res.ContentType = Mime(Path.GetExtension(t.path).ToLowerInvariant());
                res.Headers["Accept-Ranges"] = "bytes";
                res.Headers["Cache-Control"] = "no-store";
                if (partial) res.Headers["Content-Range"] = "bytes " + start + "-" + end + "/" + len;
                long left = end - start + 1;
                res.ContentLength64 = left;
                fs.Seek(start, SeekOrigin.Begin);
                byte[] buf = new byte[64 * 1024];
                while (left > 0)
                {
                    int n = fs.Read(buf, 0, (int)Math.Min(buf.Length, left));
                    if (n <= 0) break;
                    res.OutputStream.Write(buf, 0, n);
                    left -= n;
                }
            }
        }

        void Art(HttpListenerResponse res, string id)
        {
            var t = Library.Find(id);
            string file = t == null ? null : Library.ArtFile(t);
            if (file == null) { Send(res, 404, "text/plain", new byte[0]); return; }
            res.Headers["Cache-Control"] = "max-age=86400";
            Send(res, 200, "image/jpeg", File.ReadAllBytes(file));
        }

        static string Body(HttpListenerRequest req)
        {
            using (var sr = new StreamReader(req.InputStream, Encoding.UTF8)) return sr.ReadToEnd();
        }

        void Api(HttpListenerRequest req, HttpListenerResponse res, string route)
        {
            bool post = req.HttpMethod == "POST";
            switch (route)
            {
                case "info":
                    SendJson(res, "{\"version\":" + Json.Str(App.Version) + ",\"dataDir\":" + Json.Str(App.DataDir)
                        + ",\"cacheDir\":" + Json.Str(App.CacheDir) + ",\"headless\":" + (App.Headless ? "true" : "false")
                        + ",\"mediaKeys\":" + (App.MediaKeysOn ? "true" : "false") + ",\"adsBlocked\":" + App.AdsBlocked + "}");
                    return;

                case "state":
                    if (!post)
                    {
                        string s = "{}";
                        lock (stateGate)
                        {
                            try { if (File.Exists(StateFile)) s = File.ReadAllText(StateFile, Encoding.UTF8); } catch { }
                        }
                        if (string.IsNullOrWhiteSpace(s)) s = "{}";
                        SendJson(res, s);
                    }
                    else
                    {
                        string body = Body(req);
                        if (body.Length > 32 * 1024 * 1024) { Fail(res, 413, "too large"); return; }
                        try { Json.Ser().DeserializeObject(body); }
                        catch { Fail(res, 400, "bad json"); return; }
                        lock (stateGate)
                        {
                            string tmp = StateFile + ".tmp";
                            File.WriteAllText(tmp, body, new UTF8Encoding(false));
                            if (File.Exists(StateFile)) File.Replace(tmp, StateFile, StateFile + ".bak");
                            else File.Move(tmp, StateFile);
                        }
                        SendJson(res, "{\"ok\":true}");
                    }
                    return;

                case "library":
                    SendJson(res, Library.ToJson());
                    return;

                case "library/rescan":
                    if (!post) break;
                    Library.ScanAsync();
                    SendJson(res, "{\"ok\":true}");
                    return;

                case "folders/add":
                    {
                        if (!post) break;
                        string p = Json.Get(Json.Obj(Body(req)), "path");
                        if (string.IsNullOrEmpty(p))
                        {
                            if (App.Form == null) { Fail(res, 400, "no path"); return; }
                            p = (string)App.Form.Invoke(new Func<string>(App.Form.PickFolder));
                            if (p == null) { SendJson(res, "{\"ok\":false,\"cancelled\":true}"); return; }
                        }
                        bool ok = Library.AddFolder(p);
                        SendJson(res, "{\"ok\":" + (ok ? "true" : "false") + "}");
                        return;
                    }

                case "folders/remove":
                    {
                        if (!post) break;
                        string p = Json.Get(Json.Obj(Body(req)), "path");
                        if (!string.IsNullOrEmpty(p)) Library.RemoveFolder(p);
                        SendJson(res, "{\"ok\":true}");
                        return;
                    }

                case "sc/search":
                    {
                        string q = req.QueryString["q"] ?? "";
                        if (q.Trim().Length == 0) { SendJson(res, "{\"results\":[]}"); return; }
                        SendJson(res, Sc.Search(q, req.QueryString["type"] ?? "sounds"));
                        return;
                    }

                case "sc/oembed":
                    {
                        string u = req.QueryString["url"] ?? "";
                        if (!Sc.IsScUrl(u)) { Fail(res, 400, "not a soundcloud url"); return; }
                        SendJson(res, Sc.OEmbed(u));
                        return;
                    }

                case "sc/resolve":
                    {
                        string u = req.QueryString["url"] ?? "";
                        if (!Sc.IsScUrl(u)) { Fail(res, 400, "not a soundcloud url"); return; }
                        SendJson(res, "{\"url\":" + Json.Str(Sc.Resolve(u)) + "}");
                        return;
                    }

                case "yt/search":
                    {
                        string q = req.QueryString["q"] ?? "";
                        if (q.Trim().Length == 0) { SendJson(res, "{\"results\":[]}"); return; }
                        SendJson(res, Yt.Search(q));
                        return;
                    }

                case "yt/info":
                    {
                        string id = req.QueryString["id"] ?? "";
                        if (!Yt.IsId(id)) { Fail(res, 400, "not a youtube id"); return; }
                        SendJson(res, Yt.Info(id));
                        return;
                    }

                case "open":
                    {
                        if (!post) break;
                        string u = Json.Get(Json.Obj(Body(req)), "url");
                        if (u == null || !(Sc.IsScUrl(u) || Yt.IsWatchUrl(u) || u == "https://github.com/GraveRich/pulse/releases/latest")) { Fail(res, 400, "not allowed"); return; }
                        if (!App.Headless) Native.OpenExternal(u);
                        SendJson(res, "{\"ok\":true}");
                        return;
                    }

                case "reveal":
                    {
                        if (!post) break;
                        var d = Json.Obj(Body(req));
                        string id = Json.Get(d, "id");
                        string what = Json.Get(d, "what");
                        string target = null;
                        if (what == "data") target = App.DataDir;
                        else if (id != null) { var t = Library.Find(id); if (t != null) target = t.path; }
                        if (target != null && !App.Headless)
                        {
                            if (Directory.Exists(target)) Process.Start("explorer.exe", "\"" + target + "\"");
                            else if (File.Exists(target)) Process.Start("explorer.exe", "/select,\"" + target + "\"");
                        }
                        SendJson(res, "{\"ok\":true}");
                        return;
                    }

                case "selftest":
                    {
                        if (!post) break;
                        string body = Body(req);
                        if (App.SelfTestOut != null)
                        {
                            File.WriteAllText(App.SelfTestOut, body, new UTF8Encoding(false));
                            SendJson(res, "{\"ok\":true}");
                            if (App.Form != null) App.Form.BeginInvoke(new Action(App.Form.Close));
                        }
                        else SendJson(res, "{\"ok\":false}");
                        return;
                    }
            }
            Fail(res, 404, "unknown route");
        }
    }

    // ---------------------------------------------------------------- window

    class MainForm : Form
    {
        readonly WebView2 web;
        readonly string url;
        readonly string baseUrl;
        bool placed;

        static string WindowFile { get { return Path.Combine(App.DataDir, "window.json"); } }

        public MainForm(string url)
        {
            this.url = url;
            this.baseUrl = "http://localhost:" + App.Port + "/";
            Text = "Pulse";
            BackColor = Color.FromArgb(10, 10, 13);
            MinimumSize = new Size(940, 600);
            Size = new Size(1240, 800);
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.FromArgb(10, 10, 13);
            Controls.Add(web);

            if (App.Hidden)
            {
                StartPosition = FormStartPosition.Manual;
                Location = new Point(-32000, -32000);
                ShowInTaskbar = false;
            }
            else
            {
                RestorePlacement();
                if (App.Minimized) WindowState = FormWindowState.Minimized; // shown minimized, without taking focus
            }
        }

        protected override bool ShowWithoutActivation { get { return App.Hidden || App.Minimized || App.NoActivate; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                if (App.Hidden) cp.ExStyle |= 0x08000000 | 0x00000080; // WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.DarkTitleBar(Handle, 0x000D0A0A);
        }

        protected override async void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            try { await InitWeb(); }
            catch (Exception ex)
            {
                App.Log("webview init: " + ex);
                if (App.SelfTestOut != null)
                {
                    try { File.WriteAllText(App.SelfTestOut, "{\"ok\":false,\"error\":" + Json.Str("webview: " + ex.Message) + "}"); } catch { }
                    Close();
                    return;
                }
                MessageBox.Show(this, "Pulse needs the Microsoft Edge WebView2 runtime (it ships with Windows 11).\n\n" + ex.Message, "Pulse");
                Close();
            }
        }

        async Task InitWeb()
        {
            var opts = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(App.CacheDir, "WebView2"), opts);
            await web.EnsureCoreWebView2Async(env);
            var core = web.CoreWebView2;
            var s = core.Settings;
            s.AreDevToolsEnabled = App.Dev;
            s.AreDefaultContextMenusEnabled = App.Dev;
            s.AreBrowserAcceleratorKeysEnabled = App.Dev;
            s.IsStatusBarEnabled = false;
            s.IsZoomControlEnabled = false;
            s.IsPasswordAutosaveEnabled = false;
            s.IsGeneralAutofillEnabled = false;
            s.IsSwipeNavigationEnabled = false;
            try { s.IsReputationCheckingRequired = false; } catch { }

            core.NewWindowRequested += delegate(object o, CoreWebView2NewWindowRequestedEventArgs a)
            {
                a.Handled = true;
                Native.OpenExternal(a.Uri);
            };
            core.NavigationStarting += delegate(object o, CoreWebView2NavigationStartingEventArgs a)
            {
                if (!a.Uri.StartsWith(baseUrl, StringComparison.OrdinalIgnoreCase))
                {
                    a.Cancel = true;
                    Native.OpenExternal(a.Uri);
                }
            };
            core.PermissionRequested += delegate(object o, CoreWebView2PermissionRequestedEventArgs a)
            {
                a.State = CoreWebView2PermissionState.Deny;
            };
            core.WebMessageReceived += delegate(object o, CoreWebView2WebMessageReceivedEventArgs a)
            {
                if (a.Source == null || !a.Source.StartsWith(baseUrl, StringComparison.OrdinalIgnoreCase)) return;
                string m;
                try { m = a.TryGetWebMessageAsString(); } catch { return; }
                if (m == "keys:on") SetMediaKeys(true);
                else if (m == "keys:off") SetMediaKeys(false);
                else if (m != null && m.StartsWith("hk:", StringComparison.Ordinal)) SetHotkeys(m.Substring(3));
                else if (m != null && m.StartsWith("rcs:", StringComparison.Ordinal)) Remote.SetState(m.Substring(4));
                else if (m == "remote:on") { Remote.Start(); PostToPage("remote:info:" + Remote.Info()); }
                else if (m == "remote:off") { Remote.Stop(); PostToPage("remote:info:" + Remote.Info()); }
                else if (m == "remote:forget") { Remote.Forget(); PostToPage("remote:info:" + Remote.Info()); }
            };
            core.ProcessFailed += delegate(object o, CoreWebView2ProcessFailedEventArgs a)
            {
                App.Log("webview process failed: " + a.ProcessFailedKind);
                if (a.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited)
                {
                    try { core.Reload(); } catch { }
                }
            };
            // Ad blocking for the embedded players: requests to ad servers are refused here, and a small script
            // inside YouTube's player frame drops ad slots from its data and skips any ad that still gets through.
            foreach (string f in AdFilters)
            {
                try { core.AddWebResourceRequestedFilter(f, CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All); }
                catch { try { core.AddWebResourceRequestedFilter(f, CoreWebView2WebResourceContext.All); } catch { } }
            }
            core.WebResourceRequested += delegate(object o, CoreWebView2WebResourceRequestedEventArgs a)
            {
                try
                {
                    a.Response = env.CreateWebResourceResponse(null, 403, "Blocked", "");
                    Interlocked.Increment(ref App.AdsBlocked);
                }
                catch { }
            };
            await core.AddScriptToExecuteOnDocumentCreatedAsync(YtFrameScript);
            core.Navigate(url);
        }

        static readonly string[] AdFilters =
        {
            "*://*.doubleclick.net/*", "*://doubleclick.net/*", "*://*.googlesyndication.com/*", "*://*.googleadservices.com/*",
            "*://*.google.com/pagead/*", "*://imasdk.googleapis.com/*", "*://*.googletagservices.com/*",
            "*://*.youtube.com/pagead/*", "*://*.youtube.com/api/stats/ads*", "*://*.youtube.com/get_midroll_*", "*://*.youtube.com/ptracking*",
            "*://*.youtube-nocookie.com/pagead/*", "*://*.youtube-nocookie.com/api/stats/ads*"
        };

        // Runs in every frame; only acts inside YouTube's embedded player.
        const string YtFrameScript = @"(function () {
  try {
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname) || location.pathname.indexOf('/embed/') !== 0) return;
    var KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
    var stats = window.__pulseAds = { pruned: 0, skipped: 0 };
    function prune(o) {
      if (!o || typeof o !== 'object') return o;
      for (var i = 0; i < KEYS.length; i++) if (KEYS[i] in o) { delete o[KEYS[i]]; stats.pruned++; }
      if (o.playerResponse && typeof o.playerResponse === 'object') prune(o.playerResponse);
      return o;
    }
    var parse = JSON.parse;
    JSON.parse = function () { return prune(parse.apply(this, arguments)); };
    var rj = Response.prototype.json;
    Response.prototype.json = function () { return rj.apply(this, arguments).then(prune); };
    var ipr;
    try { Object.defineProperty(window, 'ytInitialPlayerResponse', { configurable: true, get: function () { return ipr; }, set: function (v) { ipr = prune(v); } }); } catch (e) {}
    var css = '.ytp-pause-overlay,.ytp-endscreen-content,.ytp-ce-element,.ytp-ad-overlay-container,.ytp-ad-message-container,.ytp-ad-module,.ytp-paid-content-overlay,.ytp-suggested-action{display:none!important}';
    function addCss() { if (!document.documentElement) return; var st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st); }
    if (document.documentElement) addCss(); else document.addEventListener('DOMContentLoaded', addCss);
    var muted = false, inAd = false;
    setInterval(function () {
      var pl = document.getElementById('movie_player');
      if (!pl) return;
      var ad = pl.classList.contains('ad-showing') || pl.classList.contains('ad-interrupting');
      var v = pl.querySelector('video');
      if (ad) {
        if (!inAd) { inAd = true; stats.skipped++; }
        if (v) {
          if (!v.muted) { v.muted = true; muted = true; }
          if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.3) v.currentTime = v.duration;
        }
        var b = pl.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
        if (b) b.click();
      } else {
        inAd = false;
        if (muted && v) { v.muted = false; muted = false; }
      }
    }, 200);
  } catch (e) {}
})();";

        // Keyboard media keys. Windows does not route them to WebView2 apps, so the host grabs them itself,
        // and only while Pulse is the thing playing (the UI asks for them on play and releases them when idle).
        static readonly uint[] MediaVk = { 0xB3, 0xB0, 0xB1, 0xB2 }; // play/pause, next, previous, stop
        static readonly string[] MediaMsg = { "media:toggle", "media:next", "media:prev", "media:stop" };

        void SetMediaKeys(bool on)
        {
            if (on == App.MediaKeysOn) return;
            bool any = false;
            for (int i = 0; i < MediaVk.Length; i++)
            {
                if (on)
                {
                    bool ok = Native.RegisterHotKey(Handle, 100 + i, 0x4000, MediaVk[i]); // MOD_NOREPEAT
                    if (!ok) App.Log("media key " + MediaMsg[i] + " not available (error " + Marshal.GetLastWin32Error() + ")");
                    any |= ok;
                }
                else Native.UnregisterHotKey(Handle, 100 + i);
            }
            App.MediaKeysOn = on && any;
        }

        // Global hotkeys chosen in Settings, so Pulse can be controlled from inside a game. The UI sends the whole
        // list as "hk:toggle=3:32,next=3:39,volup=3:38r" (name=modifiers:virtual key, r = repeats while held) and
        // gets "hk:result:<names that another app already holds>" back; a press comes back as "hk:<name>".
        readonly List<string> hotkeyNames = new List<string>();

        void SetHotkeys(string spec)
        {
            for (int i = 0; i < hotkeyNames.Count; i++) Native.UnregisterHotKey(Handle, 200 + i);
            hotkeyNames.Clear();
            var failed = new List<string>();
            foreach (string part in spec.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var m = Regex.Match(part, "^([a-z]{2,12})=(\\d{1,2}):(\\d{1,3})(r?)$");
                if (!m.Success || hotkeyNames.Count >= 16) continue;
                uint mod = uint.Parse(m.Groups[2].Value) & 0xF, vk = uint.Parse(m.Groups[3].Value);
                if (vk == 0 || vk > 254) continue;
                string name = m.Groups[1].Value;
                int id = 200 + hotkeyNames.Count;
                hotkeyNames.Add(name);
                if (!Native.RegisterHotKey(Handle, id, mod | (m.Groups[4].Value == "r" ? 0u : 0x4000u), vk))
                {
                    failed.Add(name);
                    App.Log("hotkey " + name + " not available (error " + Marshal.GetLastWin32Error() + ")");
                }
            }
            try { web.CoreWebView2.PostWebMessageAsString("hk:result:" + string.Join(",", failed)); } catch { }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x0312) // WM_HOTKEY
            {
                int id = m.WParam.ToInt32();
                string msg = null;
                if (id >= 100 && id < 100 + MediaMsg.Length) msg = MediaMsg[id - 100];
                else if (id >= 200 && id < 200 + hotkeyNames.Count) msg = "hk:" + hotkeyNames[id - 200];
                if (msg != null && web != null && web.CoreWebView2 != null)
                {
                    try { web.CoreWebView2.PostWebMessageAsString(msg); } catch { }
                }
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            try
            {
                if (web != null && web.CoreWebView2 != null)
                    web.CoreWebView2.MemoryUsageTargetLevel = WindowState == FormWindowState.Minimized
                        ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal;
            }
            catch { }
        }

        // Sends a message to the UI from any thread (used by the phone remote server).
        public void PostToPage(string msg)
        {
            try
            {
                if (IsDisposed || !IsHandleCreated) return;
                BeginInvoke(new Action(delegate
                {
                    try { if (web != null && web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsString(msg); } catch { }
                }));
            }
            catch { }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!App.Hidden) SavePlacement();
            base.OnFormClosing(e);
        }

        void RestorePlacement()
        {
            try
            {
                if (!File.Exists(WindowFile)) return;
                var d = Json.Obj(File.ReadAllText(WindowFile));
                int x = Convert.ToInt32(d["x"]), y = Convert.ToInt32(d["y"]), w = Convert.ToInt32(d["w"]), h = Convert.ToInt32(d["h"]);
                var r = new Rectangle(x, y, Math.Max(w, MinimumSize.Width), Math.Max(h, MinimumSize.Height));
                bool visible = Screen.AllScreens.Any(sc => { var i = Rectangle.Intersect(sc.WorkingArea, r); return i.Width > 200 && i.Height > 120; });
                if (!visible) return;
                StartPosition = FormStartPosition.Manual;
                Bounds = r;
                if (Convert.ToBoolean(d["max"])) WindowState = FormWindowState.Maximized;
                placed = true;
            }
            catch { }
        }

        void SavePlacement()
        {
            try
            {
                var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                if (r.Width < MinimumSize.Width || r.Height < MinimumSize.Height) return;
                File.WriteAllText(WindowFile, "{\"x\":" + r.X + ",\"y\":" + r.Y + ",\"w\":" + r.Width + ",\"h\":" + r.Height
                    + ",\"max\":" + (WindowState == FormWindowState.Maximized ? "true" : "false") + "}");
            }
            catch { }
            GC.KeepAlive(placed);
        }

        public string PickFolder()
        {
            return Native.PickFolder(Handle, "Choose a music folder");
        }
    }

    // ---------------------------------------------------------------- native bits

    static class Native
    {
        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("user32.dll")]
        static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll")]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        public static void DarkTitleBar(IntPtr hwnd, int captionColorBgr)
        {
            try
            {
                int on = 1;
                DwmSetWindowAttribute(hwnd, 20, ref on, 4);              // DWMWA_USE_IMMERSIVE_DARK_MODE
                DwmSetWindowAttribute(hwnd, 35, ref captionColorBgr, 4); // DWMWA_CAPTION_COLOR (Windows 11)
            }
            catch { }
        }

        public static void FocusOtherInstance()
        {
            try
            {
                int me = Process.GetCurrentProcess().Id;
                foreach (var p in Process.GetProcessesByName(Process.GetCurrentProcess().ProcessName))
                {
                    if (p.Id == me || p.MainWindowHandle == IntPtr.Zero) continue;
                    if (IsIconic(p.MainWindowHandle)) ShowWindow(p.MainWindowHandle, 9); // SW_RESTORE
                    SetForegroundWindow(p.MainWindowHandle);
                    return;
                }
            }
            catch { }
        }

        public static void OpenExternal(string url)
        {
            try
            {
                Uri u;
                if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return;
                if (u.Scheme != "https" && u.Scheme != "http") return;
                Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Exception ex) { App.Log("open: " + ex.Message); }
        }

        // Modern (Vista+) folder picker through IFileOpenDialog.
        public static string PickFolder(IntPtr owner, string title)
        {
            IFileOpenDialog dlg = null;
            try
            {
                dlg = (IFileOpenDialog)new FileOpenDialogRcw();
                uint opt;
                dlg.GetOptions(out opt);
                dlg.SetOptions(opt | 0x20 | 0x40); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
                dlg.SetTitle(title);
                if (dlg.Show(owner) != 0) return null;
                IShellItem item;
                dlg.GetResult(out item);
                string path;
                item.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
                return path;
            }
            catch (Exception ex)
            {
                App.Log("folder picker: " + ex.Message);
                using (var f = new FolderBrowserDialog())
                {
                    f.Description = title;
                    return f.ShowDialog() == DialogResult.OK ? f.SelectedPath : null;
                }
            }
            finally
            {
                if (dlg != null) Marshal.ReleaseComObject(dlg);
            }
        }

        [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
        class FileOpenDialogRcw { }

        [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IFileOpenDialog
        {
            [PreserveSig] int Show(IntPtr parent);
            void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
            void SetFileTypeIndex(uint iFileType);
            void GetFileTypeIndex(out uint piFileType);
            void Advise(IntPtr pfde, out uint pdwCookie);
            void Unadvise(uint dwCookie);
            void SetOptions(uint fos);
            void GetOptions(out uint pfos);
            void SetDefaultFolder(IShellItem psi);
            void SetFolder(IShellItem psi);
            void GetFolder(out IShellItem ppsi);
            void GetCurrentSelection(out IShellItem ppsi);
            void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
            void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
            void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
            void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
            void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
            void GetResult(out IShellItem ppsi);
        }

        [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItem
        {
            void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
            void GetParent(out IShellItem ppsi);
            void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        }
    }
}
