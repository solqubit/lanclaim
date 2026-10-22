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
  outsideIps,
  pingInfo,
  suggestIp,
} from "../lanclaim/static/js/model.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");
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

assert.deepEqual(suggestIp(s, NET, NOW), { address: "192.168.1.43", reason: "reserved" });
const noReserved = fixture();
noReserved.ips = noReserved.ips.filter((i) => i.address !== "192.168.1.43");
// .1 answered yesterday, .2 never answered -> first safe free host is .2
assert.deepEqual(suggestIp(noReserved, NET, NOW), { address: "192.168.1.2", reason: "free" });
const full = { ...fixture(), networks: [{ id: 2, cidr: "10.5.0.0/30", name: "" }], ips: [
  { address: "10.5.0.1", device_id: 7, note: "", claimed_at: "" },
  { address: "10.5.0.2", device_id: 7, note: "", claimed_at: "" },
] };
assert.equal(suggestIp(full, "10.5.0.0/30", NOW), null);

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

console.log("model: ok");
