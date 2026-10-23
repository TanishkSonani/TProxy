import {expect,test} from "bun:test";
import {readFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {hasCompleteWindowsPackage,windowsPackageRoot} from "../src/windows/package-path";

test("Windows controls resolve the documented LocalAppData package and require its icon files",()=>{
  const root=mkdtempSync(join(Bun.env.TMP??"C:/Windows/Temp","tproxy-package-"));
  try{
    expect(windowsPackageRoot("C:\\Users\\fixture\\AppData\\Local")).toBe(join("C:\\Users\\fixture\\AppData\\Local","Programs","TProxy"));
    expect(hasCompleteWindowsPackage(root)).toBe(false);
    for(const file of ["tproxy.exe","tproxy-desktop.exe","Open-TProxy-Terminal.cmd","SETUP-INSTRUCTIONS.md","icons/tproxy-on.ico","icons/tproxy-off.ico"]){const target=join(root,file);mkdirSync(join(target,".."),{recursive:true});writeFileSync(target,"fixture");}
    expect(hasCompleteWindowsPackage(root)).toBe(true);rmSync(join(root,"icons/tproxy-off.ico"));expect(hasCompleteWindowsPackage(root)).toBe(false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("desktop controller uses install-root sidecar icons and reports missing installs clearly",()=>{
  const source=readFileSync(join(import.meta.dir,"../src/windows/DesktopController.cs"),"utf8");
  expect(source).toMatch(/Root\s*=\s*Path\.Combine\(Environment\.GetFolderPath\(Environment\.SpecialFolder\.LocalApplicationData\), "Programs", "TProxy"\)/);
  expect(source).toContain('Path.Combine(Root, "icons", on ? "tproxy-on.ico" : "tproxy-off.ico")');
  expect(source).toContain("Extract the complete TProxy package to %LOCALAPPDATA%\\\\Programs\\\\TProxy");
});
