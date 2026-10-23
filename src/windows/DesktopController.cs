using System;
using System.IO;
using System.Drawing;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Net.Http;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
[assembly: System.Reflection.AssemblyTitle("TProxy Desktop")]
[assembly: System.Reflection.AssemblyProduct("TProxy")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

internal static class Paths {
    internal static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "TProxy");
    internal static readonly string Exe = Path.Combine(Root, "tproxy-desktop.exe");
    internal static readonly string Cli = Path.Combine(Root, "tproxy.exe");
    internal static readonly string Data = Environment.GetEnvironmentVariable("TPROXY_DATA_DIR") ?? Environment.GetEnvironmentVariable("GHCP_BRIDGE_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TProxy");
    internal static readonly string Desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "TProxy.lnk");
    internal static readonly string Startup = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "TProxy Status Monitor.lnk");
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    internal static string Icon(bool on) { return Path.Combine(Root, "icons", on ? "tproxy-on.ico" : "tproxy-off.ico"); }
    internal static string Identity {
        get { using (var hash=SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Environment.UserName+Root.ToUpperInvariant()))).Replace("-", "").Substring(0,24); }
    }
    internal static Dictionary<string,object> Read(string name) {
        try { return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(Data,name))); } catch { return new Dictionary<string,object>(); }
    }
    internal static int Port() {
        var runtime=Read("runtime.json");
        try { var process=Process.GetProcessById(Convert.ToInt32(runtime["pid"])); if (!process.HasExited) { int port=Convert.ToInt32(runtime["port"]); if(port>0 && port<=65535) return port; } } catch { }
        var config=Read("config.json"); try { int port=Convert.ToInt32(config["port"]); if(port>0 && port<=65535) return port; } catch { }
        return 4141;
    }
    internal static void Log(string text) {
        try { Directory.CreateDirectory(Data); var file=Path.Combine(Data,"desktop.log"); if(File.Exists(file) && new FileInfo(file).Length>1048576) File.WriteAllText(file,""); File.AppendAllText(file,DateTime.UtcNow.ToString("o")+" "+text+Environment.NewLine); } catch { }
    }
}
internal static class Shortcuts {
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] private static extern void SHChangeNotify(uint eventId,uint flags,string item1,IntPtr item2);
    internal static void Save(string file,bool on,bool startup) {
        object shell=null,link=null;
        try {
            shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            dynamic wsh=shell; link=wsh.CreateShortcut(file); dynamic shortcut=link;
            if(File.Exists(file) && !String.Equals(Path.GetFullPath((string)shortcut.TargetPath),Path.GetFullPath(Paths.Exe),StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("An unrelated shortcut already uses this name: "+file);
            shortcut.TargetPath=Paths.Exe; shortcut.WorkingDirectory=Paths.Root; shortcut.Arguments=startup?"--monitor":"";
            shortcut.Description="TProxy - "+(on?"ON (proxy responding)":"OFF (proxy not responding)"); shortcut.IconLocation=Paths.Icon(on)+",0"; shortcut.Save();
            SHChangeNotify(0x2000,0x0005|0x2000,file,IntPtr.Zero);
        } finally { if(link!=null)Marshal.FinalReleaseComObject(link);if(shell!=null)Marshal.FinalReleaseComObject(shell); }
    }
    internal static void Update(bool on) { if(File.Exists(Paths.Desktop)) Save(Paths.Desktop,on,false); }
    internal static void Register() {
        if(!File.Exists(Paths.Exe) || !File.Exists(Paths.Cli) || !File.Exists(Paths.Icon(false)) || !File.Exists(Paths.Icon(true))) throw new InvalidOperationException("Extract the complete TProxy package to %LOCALAPPDATA%\\Programs\\TProxy and run setup again.");
        Directory.CreateDirectory(Paths.Data);Save(Paths.Desktop,false,false);bool startup=true;
        try { Save(Paths.Startup,false,true); } catch(Exception e) { startup=false;Paths.Log("Login monitor shortcut unavailable: "+e.Message); }
        File.WriteAllText(Path.Combine(Paths.Data,"desktop-registration.json"),Paths.Json.Serialize(new {desktop=Paths.Desktop,startupRegistered=startup,installed=Paths.Root}));
        Process.Start(new ProcessStartInfo(Paths.Exe,"--monitor"){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
    }
    internal static void RemoveOwned(string file) {
        if(!File.Exists(file))return;object shell=null,link=null;
        try {shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));dynamic wsh=shell;link=wsh.CreateShortcut(file);dynamic shortcut=link;
            if(String.Equals(Path.GetFullPath((string)shortcut.TargetPath),Path.GetFullPath(Paths.Exe),StringComparison.OrdinalIgnoreCase))File.Delete(file);
        }finally{if(link!=null)Marshal.FinalReleaseComObject(link);if(shell!=null)Marshal.FinalReleaseComObject(shell);}
    }
}
internal sealed class Controller : ApplicationContext {
    private readonly Form form;
    private readonly Label status,detail;
    private readonly Button toggle,dashboard;
    private readonly NotifyIcon tray;
    private readonly ToolStripMenuItem trayToggle;
    private readonly System.Windows.Forms.Timer timer;
    private readonly HttpClient http;
    private bool busy=false,checking=false,on=false,known=false,foreign=false;
    private readonly EventWaitHandle show,quit,toggleEvent;
    private readonly RegisteredWaitHandle showWait,quitWait,toggleWait;
    internal Controller(bool monitor) {
        Directory.CreateDirectory(Paths.Data);
        show=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\TProxyShow-"+Paths.Identity);
        quit=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\TProxyQuit-"+Paths.Identity);
        toggleEvent=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\TProxyToggle-"+Paths.Identity);
        http=new HttpClient(new HttpClientHandler{UseProxy=false});http.Timeout=TimeSpan.FromSeconds(2);
        form=new Form{Text="TProxy",ClientSize=new Size(448,330),StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,BackColor=Color.FromArgb(15,23,42),ForeColor=Color.White,Font=new Font("Segoe UI",10),Icon=new Icon(Paths.Icon(false))};
        var title=new Label{Text="TProxy",Font=new Font("Segoe UI",24,FontStyle.Bold),Location=new Point(28,20),Size=new Size(380,48)};
        status=new Label{Text="Checking proxy status…",Font=new Font("Segoe UI",14,FontStyle.Bold),Location=new Point(30,88),Size=new Size(390,32)};
        detail=new Label{Text="Local Copilot gateway for Claude Code",Location=new Point(30,127),Size=new Size(390,42),ForeColor=Color.Silver};
        toggle=Button("Start server",30,184,186);dashboard=Button("Open dashboard",230,184,186);
        var terminal=Button("Open terminal",30,237,186);var instructions=Button("Setup instructions",230,237,186);
        form.Controls.AddRange(new Control[]{title,status,detail,toggle,dashboard,terminal,instructions});
        toggle.Click+=async(s,e)=>await Toggle();dashboard.Click+=async(s,e)=>await OpenDashboard();
        terminal.Click+=(s,e)=>OpenTerminal();instructions.Click+=(s,e)=>OpenFile("SETUP-INSTRUCTIONS.md");
        form.FormClosing+=(s,e)=>{if(e.CloseReason==CloseReason.UserClosing){e.Cancel=true;form.Hide();}};
        var menu=new ContextMenuStrip();menu.Items.Add("Open TProxy",null,(s,e)=>Show());trayToggle=new ToolStripMenuItem("Start server",null,async(s,e)=>await Toggle());menu.Items.Add(trayToggle);
        menu.Items.Add("Open dashboard",null,async(s,e)=>await OpenDashboard());menu.Items.Add("Open terminal",null,(s,e)=>OpenTerminal());menu.Items.Add(new ToolStripSeparator());menu.Items.Add("Exit status monitor",null,(s,e)=>ExitThread());
        tray=new NotifyIcon{Text="TProxy - checking",Icon=new Icon(Paths.Icon(false)),ContextMenuStrip=menu,Visible=true};tray.DoubleClick+=(s,e)=>Show();
        // Force handle creation even in monitor-only mode, for the single-instance events.
        var handle=form.Handle;
        showWait=ThreadPool.RegisterWaitForSingleObject(show,(s,t)=>form.BeginInvoke((Action)Show),null,Timeout.Infinite,false);
        quitWait=ThreadPool.RegisterWaitForSingleObject(quit,(s,t)=>form.BeginInvoke((Action)ExitThread),null,Timeout.Infinite,false);
        toggleWait=ThreadPool.RegisterWaitForSingleObject(toggleEvent,(s,t)=>form.BeginInvoke((Action)(async()=>await Toggle())),null,Timeout.Infinite,false);
        timer=new System.Windows.Forms.Timer{Interval=3000};timer.Tick+=async(s,e)=>await Refresh();timer.Start();
        if(!monitor)Show();Task.Run(async()=>{await Task.Delay(100);form.BeginInvoke((Action)(async()=>await Refresh()));});
    }
    private Button Button(string text,int x,int y,int width) { return new Button{Text=text,Location=new Point(x,y),Size=new Size(width,40),FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(30,41,59),ForeColor=Color.White}; }
    private void Show(){form.Show();form.WindowState=FormWindowState.Normal;form.Activate();}
    private async Task Refresh(){
        if(checking)return;checking=true;bool running=false;foreign=false;int port=Paths.Port();
        try{var response=await http.GetAsync("http://127.0.0.1:"+port+"/health");if(response.IsSuccessStatusCode){var json=Paths.Json.Deserialize<Dictionary<string,object>>(await response.Content.ReadAsStringAsync());string service=json.ContainsKey("service")?Convert.ToString(json["service"]):"";running=service=="tproxy"||service=="ghcp-bridge";foreign=!running;}}catch{}
        finally{checking=false;}
        on=running;status.Text=running?"ON — proxy responding":"OFF — proxy not responding";status.ForeColor=running?Color.FromArgb(52,211,153):Color.FromArgb(148,163,184);
        detail.Text=foreign?"Another service is using port "+port+". TProxy will not stop it.":"127.0.0.1:"+port+" · "+(running?"Close this window to keep the monitor in the tray.":"Start TProxy here or with tproxy start.");
        toggle.Text=running?"Stop server":"Start server";toggle.Enabled=!busy&&!foreign;dashboard.Enabled=running&&!busy;trayToggle.Text=toggle.Text;trayToggle.Enabled=toggle.Enabled;tray.Text="TProxy - "+(running?"ON":"OFF")+" (port "+port+")";
        if(!known||running!=knownOn){known=true;knownOn=running;var icon=new Icon(Paths.Icon(running));tray.Icon=icon;form.Icon=icon;try{Shortcuts.Update(running);}catch(Exception e){Paths.Log("Shortcut icon update: "+e.Message);}}
        try{File.WriteAllText(Path.Combine(Paths.Data,"desktop-status.json"),Paths.Json.Serialize(new {running=running,port=port,checkedAt=DateTime.UtcNow.ToString("o"),icon=Paths.Icon(running),shortcut=Paths.Desktop}));}catch{}
    }
    private bool knownOn=false;
    internal void QueueToggle(){form.BeginInvoke((Action)(async()=>{await Refresh();await Toggle();}));}
    private async Task<string> RunCli(string args){
        using(var process=new Process{StartInfo=new ProcessStartInfo(Paths.Cli,args){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=Paths.Root}}){
            process.Start();var output=process.StandardOutput.ReadToEndAsync();var error=process.StandardError.ReadToEndAsync();bool done=await Task.Run(()=>process.WaitForExit(35000));
            if(!done){try{process.Kill();}catch{}throw new InvalidOperationException("TProxy command timed out. Check the setup guide and local desktop.log.");}
            string text=await output,err=await error;if(process.ExitCode!=0)throw new InvalidOperationException(String.IsNullOrWhiteSpace(err)?"TProxy command failed.":err.Trim());return text.Trim();
        }
    }
    private async Task Toggle(){
        if(busy)return;busy=true;toggle.Enabled=false;dashboard.Enabled=false;trayToggle.Enabled=false;
        try{if(on){await RunCli("stop");await Task.Delay(400);}else{
            var info=new ProcessStartInfo(Paths.Cli,"start --quiet"){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=Paths.Root};
            var process=new Process{StartInfo=info};process.OutputDataReceived+=(s,e)=>{if(e.Data!=null)Paths.Log(e.Data);};process.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)Paths.Log(e.Data);};process.Start();process.BeginOutputReadLine();process.BeginErrorReadLine();
            status.Text="Starting TProxy…";for(int i=0;i<30;i++){await Task.Delay(1000);await Refresh();if(on)break;if(process.HasExited)throw new InvalidOperationException("Server did not start. See desktop.log or run tproxy start in the terminal.");}
            if(!on)throw new InvalidOperationException("Startup is still pending. Check the terminal; the monitor will continue checking.");
        }}catch(Exception e){MessageBox.Show(e.Message,"TProxy",MessageBoxButtons.OK,MessageBoxIcon.Warning);}finally{busy=false;}await Refresh();
    }
    private async Task OpenDashboard(){try{string url=await RunCli("dashboard");var parsed=new Uri(url);if(parsed.Scheme!="http"||parsed.Host!="127.0.0.1"||parsed.Port!=Paths.Port())throw new InvalidOperationException("Unexpected local dashboard URL");Process.Start(new ProcessStartInfo(url){UseShellExecute=true});}catch(Exception e){MessageBox.Show(e.Message,"TProxy",MessageBoxButtons.OK,MessageBoxIcon.Warning);}}
    private void OpenTerminal(){Process.Start(new ProcessStartInfo(Environment.GetEnvironmentVariable("COMSPEC")??"cmd.exe","/d /c \"\""+Path.Combine(Paths.Root,"Open-TProxy-Terminal.cmd")+"\"\""){UseShellExecute=false,CreateNoWindow=false,WorkingDirectory=Paths.Root});}
    private void OpenFile(string name){try{Process.Start(new ProcessStartInfo(Path.Combine(Paths.Root,name)){UseShellExecute=true});}catch(Exception e){MessageBox.Show(e.Message,"TProxy");}}
    protected override void ExitThreadCore(){timer.Stop();timer.Dispose();tray.Visible=false;tray.Dispose();showWait.Unregister(null);quitWait.Unregister(null);toggleWait.Unregister(null);show.Dispose();quit.Dispose();toggleEvent.Dispose();http.Dispose();form.Dispose();base.ExitThreadCore();}
}
internal static class Program {
    private static void Signal(string name){try{using(var handle=EventWaitHandle.OpenExisting("Local\\TProxy"+name+"-"+Paths.Identity))handle.Set();}catch(WaitHandleCannotBeOpenedException){}}
    [STAThread] private static int Main(string[] args){
        try{
            if(Array.IndexOf(args,"--quit-monitor")>=0){Signal("Quit");return 0;}
            if(Array.IndexOf(args,"--unregister")>=0){Signal("Quit");Shortcuts.RemoveOwned(Paths.Desktop);Shortcuts.RemoveOwned(Paths.Startup);return 0;}
            if(Array.IndexOf(args,"--register")>=0){Shortcuts.Register();return 0;}
            if(!File.Exists(Paths.Exe)||!File.Exists(Paths.Cli)||!File.Exists(Paths.Icon(false))||!File.Exists(Paths.Icon(true)))throw new InvalidOperationException("Extract the complete TProxy package to %LOCALAPPDATA%\\Programs\\TProxy before opening the desktop controller.");
            bool created;using(var mutex=new Mutex(true,"Local\\TProxy-"+Paths.Identity,out created)){
                bool toggle=Array.IndexOf(args,"--toggle")>=0;
                if(!created){if(toggle)Signal("Toggle");else if(Array.IndexOf(args,"--monitor")<0)Signal("Show");return 0;}
                Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);var controller=new Controller(toggle||Array.IndexOf(args,"--monitor")>=0);if(toggle)controller.QueueToggle();Application.Run(controller);mutex.ReleaseMutex();return 0;
            }
        }catch(Exception e){Paths.Log("Desktop controller: "+e.Message);if(args.Length==0)MessageBox.Show(e.Message,"TProxy",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
    }
}
