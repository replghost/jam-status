import test from "node:test";
import assert from "node:assert/strict";
import {
  bytesToHex,
  hexToBytes,
  validityBounds,
  validityPeriodAt,
  webTransportCertificateDer,
  webTransportCertificateHash,
  webTransportSerial
} from "../src/certificates.js";

const compressed = hexToBytes("023b2c2dccc47689f5e23954f449d9689cae6351d40c1c2520f3538d809daffa04");
const der2072 = "308201443081f7a003020102020820dbcba0be3fb21c300506032b6570300e310c300a06035504030c036a616d301e170d3236303932333030303030305a170d3236313030353030303030305a300e310c300a06035504030c036a616d3059301306072a8648ce3d020106082a8648ce3d030107034200043b2c2dccc47689f5e23954f449d9689cae6351d40c1c2520f3538d809daffa0498fb2c7ecfde6e286fd1c9203c1c8e9d50f37bce6b571b60d3978617424cfd48a344304230400603551d110439303782357633626c3263677479776c636c7072686875633574756d646e34756c68776972326d61686b63716d36746b6462796f367632686261300506032b657003410000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

test("certificate reconstruction matches a real patched PolkaJAM node", async () => {
  assert.equal(validityPeriodAt(1_790_380_800), 2072);
  assert.deepEqual(validityBounds(2072), [2072 * 864_000 - 86_400, 2073 * 864_000 + 86_400]);
  assert.equal(await webTransportSerial(compressed, 2072), 0x20dbcba0be3fb21cn);
  assert.equal(bytesToHex(await webTransportCertificateDer(compressed, 2072, "distinct")), der2072);
  assert.equal(
    bytesToHex(await webTransportCertificateHash(compressed, 2072, "distinct")),
    "31f457efb35cc02a9db8c4b725a20626828dce21648d7b498663cff82131ea49"
  );
});
