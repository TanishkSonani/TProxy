import {existsSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

export function windowsPackageRoot(localAppData=process.env.LOCALAPPDATA??join(homedir(),"AppData","Local")) {
  return join(localAppData,"Programs","TProxy");
}
export function hasCompleteWindowsPackage(root=windowsPackageRoot()) {
  return ["tproxy.exe","tproxy-desktop.exe","Open-TProxy-Terminal.cmd","SETUP-INSTRUCTIONS.md","icons/tproxy-on.ico","icons/tproxy-off.ico"].every(file=>existsSync(join(root,file)));
}
