import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("AvaTriageRegistry", function () {
  async function deployFixture() {
    const [auditor1, auditor2, target1, target2] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("AvaTriageRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();
    return { registry, auditor1, auditor2, target1, target2 };
  }

  const SAMPLE_HASH = ethers.keccak256(ethers.toUtf8Bytes("sample-triage-report-v1"));
  const SAMPLE_HASH_2 = ethers.keccak256(ethers.toUtf8Bytes("sample-triage-report-v2"));
  const SAMPLE_IPFS = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

  describe("Recording Attestations", function () {
    it("records a valid attestation and emits AttestationRecorded", async function () {
      const { registry, auditor1, target1 } = await deployFixture();

      await expect(
        registry.connect(auditor1).recordAttestation(target1.address, SAMPLE_HASH, 95, SAMPLE_IPFS)
      )
        .to.emit(registry, "AttestationRecorded")
        .withArgs(
          0,
          target1.address,
          auditor1.address,
          SAMPLE_HASH,
          95,
          SAMPLE_IPFS,
          anyValue
        );

      expect(await registry.totalAttestations()).to.equal(1);

      const att = await registry.getAttestation(0);
      expect(att.id).to.equal(0);
      expect(att.targetContract).to.equal(target1.address);
      expect(att.auditor).to.equal(auditor1.address);
      expect(att.reportHash).to.equal(SAMPLE_HASH);
      expect(att.priorityScore).to.equal(95);
      expect(att.ipfsUri).to.equal(SAMPLE_IPFS);
      expect(att.timestamp).to.be.greaterThan(0);
    });

    it("allows empty ipfsUri and boundary scores 0 and 100", async function () {
      const { registry, auditor1, target1, target2 } = await deployFixture();

      await registry.connect(auditor1).recordAttestation(target1.address, SAMPLE_HASH, 0, "");
      await registry.connect(auditor1).recordAttestation(target2.address, SAMPLE_HASH_2, 100, "");

      expect((await registry.getAttestation(0)).priorityScore).to.equal(0);
      expect((await registry.getAttestation(1)).priorityScore).to.equal(100);
    });

    it("allows different auditors to attest the same target and reportHash", async function () {
      const { registry, auditor1, auditor2, target1 } = await deployFixture();

      await registry.connect(auditor1).recordAttestation(target1.address, SAMPLE_HASH, 85, SAMPLE_IPFS);
      await registry.connect(auditor2).recordAttestation(target1.address, SAMPLE_HASH, 88, SAMPLE_IPFS);

      const ids = await registry.getAttestationIdsByTarget(target1.address);
      expect(ids.map((x: bigint) => Number(x))).to.deep.equal([0, 1]);

      const latest = await registry.getLatestAttestation(target1.address);
      expect(latest.id).to.equal(1);
      expect(latest.auditor).to.equal(auditor2.address);
      expect(latest.priorityScore).to.equal(88);
    });
  });

  describe("Input Validation & Edge Cases", function () {
    it("reverts on zero targetContract address", async function () {
      const { registry, auditor1 } = await deployFixture();
      await expect(
        registry.connect(auditor1).recordAttestation(ethers.ZeroAddress, SAMPLE_HASH, 50, SAMPLE_IPFS)
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("reverts on zero reportHash", async function () {
      const { registry, auditor1, target1 } = await deployFixture();
      await expect(
        registry.connect(auditor1).recordAttestation(target1.address, ethers.ZeroHash, 50, SAMPLE_IPFS)
      ).to.be.revertedWithCustomError(registry, "InvalidReportHash");
    });

    it("reverts when priorityScore exceeds 100", async function () {
      const { registry, auditor1, target1 } = await deployFixture();
      await expect(
        registry.connect(auditor1).recordAttestation(target1.address, SAMPLE_HASH, 101, SAMPLE_IPFS)
      )
        .to.be.revertedWithCustomError(registry, "InvalidPriorityScore")
        .withArgs(101);
    });

    it("reverts when ipfsUri exceeds 512 bytes", async function () {
      const { registry, auditor1, target1 } = await deployFixture();
      const longUri = "ipfs://" + "a".repeat(506); // 513 bytes
      await expect(
        registry.connect(auditor1).recordAttestation(target1.address, SAMPLE_HASH, 50, longUri)
      )
        .to.be.revertedWithCustomError(registry, "IpfsUriTooLong")
        .withArgs(513, 512);
    });

    it("reverts on duplicate attestation by same auditor for same target and hash", async function () {
      const { registry, auditor1, target1 } = await deployFixture();
      await registry.connect(auditor1).recordAttestation(target1.address, SAMPLE_HASH, 80, SAMPLE_IPFS);

      await expect(
        registry.connect(auditor1).recordAttestation(target1.address, SAMPLE_HASH, 80, SAMPLE_IPFS)
      )
        .to.be.revertedWithCustomError(registry, "DuplicateAttestation")
        .withArgs(auditor1.address, target1.address, SAMPLE_HASH);
    });

    it("reverts getAttestation for out-of-bounds ID", async function () {
      const { registry } = await deployFixture();
      await expect(registry.getAttestation(0))
        .to.be.revertedWithCustomError(registry, "AttestationNotFound")
        .withArgs(0);
    });

    it("reverts getLatestAttestation when target has no attestations", async function () {
      const { registry, target1 } = await deployFixture();
      await expect(registry.getLatestAttestation(target1.address))
        .to.be.revertedWithCustomError(registry, "NoAttestationsForTarget")
        .withArgs(target1.address);
    });
  });
});

