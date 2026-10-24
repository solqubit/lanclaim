import assert from "node:assert/strict";
import {
  agoText,
  counts,
  deviceIps,
  findDeviceByName,
  ipStatus,
  isEdge,
  matches,
  networkHosts,
  networkOf,
  osSuggestions,
  deviceTree,
  machineForPlatform,
  machines,
  platformLabels,
  effectivePlatform,
  labelUsage,
  osFamily,
  OS_LIBRARY,
  splitOs,
  composeOs,
  outsideIps,
  pingInfo,
  pingLabel,
} from "../lanclaim/static/js/model.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");
Date.now = () => NOW;
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const NET = "192.168.1.0/24";

function fixture() {
  return {
    networks: [{ id: 1, cidr: NET, name: "Casa" }],
    devices: [
      { id: 7, name: "glpi", type: "vm", os: "Debian 12", note: "" },
      { id: 8, name: "nas-01", type: "fisica", os: "", note: "" },
    ],
    ips: [
      { address: "192.168.1.30", device_id: 7, note: "", claimed_at: "" },
      { address: "192.168.1.100", device_id: 7, note: "", claimed_at: "" },
      { address: "192.168.1.43", device_id: null, note: "Para Jellyfin", claimed_at: "" },
      { address: "10.9.9.9", device_id: 8, note: "", claimed_at: "" },
    ],
    observations: {
      "192.168.1.7": { up: true, checked_at: daysAgo(0), last_up_at: daysAgo(0) },
      "192.168.1.30": { up: true, checked_at: daysAgo(0), last_up_at: daysAgo(0) },
      "192.168.1.88": { up: false, checked_at: daysAgo(0), last_up_at: daysAgo(2) },
      "192.168.1.9": { up: false, checked_at: daysAgo(0), last_up_at: daysAgo(10) },
      "192.168.1.1": { up: false, checked_at: daysAgo(0), last_up_at: daysAgo(1) },
      "192.168.1.2": { up: false, checked_at: daysAgo(0), last_up_at: null },
    },
  };
}

const s = fixture();
assert.equal(ipStatus(s, "192.168.1.30"), "use");
assert.equal(ipStatus(s, "192.168.1.43"), "res");
assert.equal(ipStatus(s, "192.168.1.7"), "occ");
assert.equal(ipStatus(s, "192.168.1.88"), "free");
assert.equal(ipStatus(s, "192.168.1.200"), "free");

assert.equal(pingInfo(s, "192.168.1.88", NOW).recent, true);
assert.equal(pingInfo(s, "192.168.1.88", NOW).up, false);
assert.equal(pingInfo(s, "192.168.1.9", NOW).recent, false);
assert.equal(pingInfo(s, "192.168.1.200", NOW).up, null);
assert.equal(pingInfo(s, "192.168.1.88", NOW).lastUpAgoMin, 2880);

assert.equal(networkHosts("10.0.0.0/30").length, 4);
assert.deepEqual(networkHosts("10.0.0.0/30"), ["10.0.0.0", "10.0.0.1", "10.0.0.2", "10.0.0.3"]);
assert.equal(networkHosts("10.0.0.0/22").length, 1024);
assert.equal(networkHosts("10.0.0.0/22")[1023], "10.0.3.255");
assert.equal(isEdge("10.0.0.0/30", "10.0.0.0"), true);
assert.equal(isEdge("10.0.0.0/30", "10.0.0.3"), true);
assert.equal(isEdge("10.0.0.0/30", "10.0.0.1"), false);

const c = counts(s, NET);
assert.equal(c.use + c.res + c.occ + c.free, 254);
assert.deepEqual([c.use, c.res, c.occ], [2, 1, 1]);

assert.equal(pingInfo(s, "192.168.1.200", NOW).status, "unknown");
assert.equal(pingInfo(s, "192.168.1.7", NOW).status, "up");
assert.equal(pingInfo(s, "192.168.1.88", NOW).status, "down");
const stale = { ...fixture(), observations: { "192.168.1.7": { up: true, checked_at: daysAgo(1), last_up_at: daysAgo(1) } } };
assert.equal(pingInfo(stale, "192.168.1.7", NOW).status, "stale");
assert.equal(pingInfo(stale, "192.168.1.7", NOW).up, null);
assert.equal(ipStatus(stale, "192.168.1.7"), "free");
const failed = { ...fixture(), observations: { "192.168.1.30": { up: true, checked_at: daysAgo(0), last_up_at: daysAgo(1), error: "no route" } } };
assert.equal(pingInfo(failed, "192.168.1.30", NOW).status, "failed");
assert.equal(pingInfo(failed, "192.168.1.30", NOW).up, null);
assert.equal(ipStatus(failed, "192.168.1.30"), "use", "probe failures never release assignments");
assert.equal(pingLabel(pingInfo(failed, "192.168.1.30", NOW)), "Comprobación fallida");
assert.equal(pingInfo({ ...stale, scan: { interval: 86400 } }, "192.168.1.7", NOW).status, "up", "freshness allows the configured cycle");

assert.deepEqual(outsideIps(s).map((i) => i.address), ["10.9.9.9"]);
assert.equal(networkOf(s, "192.168.1.5").cidr, NET);
assert.equal(networkOf(s, "10.9.9.9"), null);

assert.equal(matches(s, "192.168.1.30", "GLP"), true);
assert.equal(matches(s, "192.168.1.43", "jelly"), true);
assert.equal(matches(s, "192.168.1.31", "glp"), false);
assert.equal(matches(s, "192.168.1.31", "1.31"), true);
assert.equal(matches(s, "192.168.1.31", ""), true);

assert.deepEqual(deviceIps(s, 7), ["192.168.1.30", "192.168.1.100"]);
assert.equal(findDeviceByName(s, "GLPI").id, 7);
assert.equal(findDeviceByName(s, " nas-01 ").id, 8);
assert.equal(findDeviceByName(s, "nope"), null);

assert.equal(agoText(0), "ahora");
assert.equal(agoText(5), "hace 5 min");
assert.equal(agoText(180), "hace 3 h");
assert.equal(agoText(1440), "hace 1 día");
assert.equal(agoText(2880), "hace 2 días");

const choices = ["Ubuntu 24.04", "Debian 12", "Debian 13", "Windows Server 2022", "TrueNAS Scale"];
assert.deepEqual(osSuggestions(choices, ""), choices);
assert.deepEqual(osSuggestions(choices, "deb"), ["Debian 12", "Debian 13"]);
assert.deepEqual(osSuggestions(choices, " DEBIAN 12 "), []); // already chosen
assert.deepEqual(osSuggestions(choices, "", 2), ["Ubuntu 24.04", "Debian 12"]);
assert.deepEqual(osSuggestions(undefined, "x"), []);

const lab = {
  networks: [], observations: {},
  ips: [{ address: "192.168.0.237", device_id: 1, note: "", claimed_at: "" }],
  devices: [
    { id: 1, name: "Cubito", type: "fisica", os: "", note: "", host_id: null, platform: "Vates XCP-ng" },
    { id: 2, name: "Nagios XI", type: "vm", os: "Centos 9", note: "", host_id: 1, platform: "Vates XCP-ng" },
    { id: 3, name: "XOA", type: "vm", os: "", note: "", host_id: 1, platform: "Vates XCP-ng" },
    { id: 4, name: "Mi PC", type: "fisica", os: "", note: "", host_id: null, platform: "VMware Workstation Pro" },
    { id: 5, name: "Servidor 2", type: "vm", os: "", note: "", host_id: 4, platform: "VMware Workstation Pro" },
    { id: 6, name: "Servidor 1", type: "vm", os: "", note: "", host_id: 4, platform: "VMware Workstation Pro" },
    { id: 7, name: "windows-dc", type: "vm", os: "", note: "", host_id: null, platform: "VMware ESXi" },
    { id: 8, name: "GLPI", type: "vm", os: "", note: "", host_id: null, platform: "" },
    { id: 9, name: "nas", type: "fisica", os: "", note: "", host_id: null, platform: "" },
    { id: 10, name: "lost", type: "vm", os: "", note: "", host_id: 99, platform: "" },
  ],
  platform_choices: ["VMware Workstation Pro", "Vates XCP-ng", "VMware ESXi", "Nutanix AHV", "KVM"],
};
const flat = deviceTree(lab, () => true).map((n) => (n.group ? `G:${n.group}:${n.count}` : `${n.depth}:${n.device.name}:${n.guests}`));
// Physical machines with their VMs first, then VMs grouped by platform (no machine), then the rest.
assert.deepEqual(flat, [
  "0:Cubito:2", "1:Nagios XI:0", "1:XOA:0",
  "0:Mi PC:2", "1:Servidor 1:0", "1:Servidor 2:0",
  "0:nas:0",
  "G:VMware ESXi:1", "1:windows-dc:0",
  "0:GLPI:0", "0:lost:0",
]);
// A match keeps its machine (or platform group) visible.
assert.deepEqual(deviceTree(lab, (d) => d.name === "XOA").map((n) => n.group || n.device.name), ["Cubito", "XOA"]);
assert.deepEqual(deviceTree(lab, (d) => d.name === "windows-dc").map((n) => n.group || n.device.name), ["VMware ESXi", "windows-dc"]);
assert.deepEqual(machines(lab).map((d) => d.name), ["Cubito", "Mi PC", "nas"]);
// Platform labels: removable only while no device uses them.
assert.deepEqual(platformLabels(lab).map((l) => `${l.name}:${l.removable ? "x" : "in-use"}`),
  ["VMware Workstation Pro:in-use", "Vates XCP-ng:in-use", "VMware ESXi:in-use", "Nutanix AHV:x", "KVM:x"]);
// Choosing a platform fills the machine only when exactly one machine runs it.
assert.equal(machineForPlatform(lab, "vates xcp-ng")?.name, "Cubito");
assert.equal(machineForPlatform(lab, "VMware ESXi"), null);
assert.equal(machineForPlatform({ ...lab, devices: [...lab.devices, { id: 11, name: "Cubito 2", type: "fisica", os: "", note: "", host_id: null, platform: "Vates XCP-ng" }] }, "Vates XCP-ng"), null);

const home = {
  networks: [], observations: {}, ips: [],
  devices: [
    { id: 1, name: "PC SOL", type: "fisica", os: "Windows 11", note: "", host_id: null, platform: "VMware Workstation Pro", dhcp: true },
    { id: 2, name: "W10", type: "vm", os: "Windows 10", note: "", host_id: 1, platform: "", dhcp: false },
    { id: 3, name: "nas", type: "fisica", os: "TrueNAS Scale", note: "", host_id: null, platform: "", dhcp: false },
    { id: 4, name: "app", type: "vm", os: "Ubuntu 24.04", note: "", host_id: 3, platform: "Docker", dhcp: false },
    { id: 5, name: "loose", type: "vm", os: "ubuntu 24.04", note: "", host_id: null, platform: "VMware ESXi", dhcp: false },
  ],
  os_choices: ["Ubuntu 24.04", "Windows 10", "Windows 11", "TrueNAS Scale", "Arch"],
  platform_choices: ["VMware Workstation Pro", "Docker", "VMware ESXi", "KVM"],
};
// Inherited from the machine when it has a platform; otherwise the VM's own one.
assert.deepEqual(effectivePlatform(home, home.devices[1]), { name: "VMware Workstation Pro", inherited: true, from: "PC SOL" });
assert.deepEqual(effectivePlatform(home, home.devices[3]), { name: "Docker", inherited: false, from: null });
assert.deepEqual(effectivePlatform(home, home.devices[0]), { name: "VMware Workstation Pro", inherited: false, from: null });
// Usage counts every device that ends up on that label (case-insensitive), in saved order.
const usage = labelUsage(home);
assert.deepEqual(usage.platforms.map((l) => `${l.name}:${l.count}`), ["VMware Workstation Pro:2", "Docker:1", "VMware ESXi:1", "KVM:0"]);
assert.deepEqual(usage.os.map((l) => `${l.name}:${l.count}`), ["Ubuntu 24.04:2", "Windows 10:1", "Windows 11:1", "TrueNAS Scale:1", "Arch:0"]);
// OS family for the icon.
const families = {
  "Windows Server 2022": "windows", "windows 10": "windows", "Ubuntu 24.04": "ubuntu", "Debian 13": "debian",
  "Rocky Linux 9": "rocky", "Centos 9": "centos", "CentOS Stream 9": "centos", "Red Hat Enterprise Linux 9": "redhat",
  "RHEL 8": "redhat", "Fedora 41": "fedora", "AlmaLinux 9": "alma", "Alpine 3.20": "alpine", "Arch": "arch",
  "openSUSE Leap": "opensuse", "FreeBSD 14": "freebsd", "TrueNAS Scale": "truenas", "Proxmox VE 8": "proxmox",
  "macOS Sequoia": "macos", "Linux Mint 22": "linux", "Kali Linux": "linux", "pfSense": null, "": null,
};
for (const [os, family] of Object.entries(families)) assert.equal(osFamily(os), family, os);

// The OS library: one entry per system, names without version, plus generic Linux and "other".
assert.deepEqual(OS_LIBRARY.map((o) => o.key).slice(0, 3), ["windows", "ubuntu", "debian"]);
assert.ok(OS_LIBRARY.some((o) => o.key === "linux" && o.askName) && OS_LIBRARY.some((o) => o.key === "otro" && o.askName));
assert.ok(OS_LIBRARY.every((o) => !/\d/.test(o.name)), "library names carry no version");
// Splitting what is stored ("Ubuntu 24.04") into system + version, and back.
const split = (os) => JSON.stringify(splitOs(os));
assert.equal(split("Ubuntu 24.04"), JSON.stringify({ key: "ubuntu", name: "", version: "24.04" }));
assert.equal(split("Windows Server 2022"), JSON.stringify({ key: "windows", name: "", version: "Server 2022" }));
assert.equal(split("Rocky Linux 9"), JSON.stringify({ key: "rocky", name: "", version: "9" }));
assert.equal(split("Centos 9"), JSON.stringify({ key: "centos", name: "", version: "9" }));
assert.equal(split("RHEL 8"), JSON.stringify({ key: "redhat", name: "", version: "8" }));
assert.equal(split("Proxmox VE 8"), JSON.stringify({ key: "proxmox", name: "", version: "8" }));
assert.equal(split("Linux Mint 22"), JSON.stringify({ key: "linux", name: "Linux Mint 22", version: "" }));
assert.equal(split("pfSense 2.7"), JSON.stringify({ key: "otro", name: "pfSense 2.7", version: "" }));
assert.equal(split(""), JSON.stringify({ key: "", name: "", version: "" }));
assert.equal(composeOs("ubuntu", "", " 24.04 "), "Ubuntu 24.04");
assert.equal(composeOs("windows", "", ""), "Windows");
assert.equal(composeOs("linux", "Linux Mint", "22"), "Linux Mint 22");
assert.equal(composeOs("otro", "pfSense", "2.7"), "pfSense 2.7");
assert.equal(composeOs("", "", "9"), "");
// Round trip keeps the family.
for (const os of ["Ubuntu 24.04", "Debian 13", "Windows 10", "AlmaLinux 9", "TrueNAS Scale"]) {
  const { key, name, version } = splitOs(os);
  assert.equal(osFamily(composeOs(key, name, version)), osFamily(os), os);
}

console.log("model: ok");
