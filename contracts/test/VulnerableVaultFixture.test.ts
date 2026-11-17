import { expect } from "chai";
import { ethers } from "hardhat";

describe("Isolated Security Fixtures (Local EVM Only)", function () {
  describe("VulnerableVaultFixture", function () {
    it("is vulnerable to reentrancy in withdraw() (VULN-001)", async function () {
      const [deployer, innocentUser, attackerSigner] = await ethers.getSigners();

      const Vault = await ethers.getContractFactory("VulnerableVaultFixture", deployer);
      const vault = await Vault.deploy();
      await vault.waitForDeployment();

      // Innocent user deposits 5 ETH/AVAX (local test ether only)
      await vault.connect(innocentUser).deposit({ value: ethers.parseEther("5") });
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(
        ethers.parseEther("5")
      );

      // Deploy attacker fixture targeting VulnerableVaultFixture
      const Attacker = await ethers.getContractFactory("ReentrancyAttackerFixture", attackerSigner);
      const attacker = await Attacker.deploy(await vault.getAddress());
      await attacker.waitForDeployment();

      // Attack with 1 ETH seed; drains multiple 1 ETH chunks via reentrancy
      await attacker.connect(attackerSigner).attack({ value: ethers.parseEther("1") });

      const attackerBal = await ethers.provider.getBalance(await attacker.getAddress());
      expect(attackerBal).to.be.greaterThan(ethers.parseEther("1"));
    });

    it("allows unauthorized caller to invoke emergencyDrain() (VULN-002)", async function () {
      const [deployer, depositor, randomCaller, drainRecipient] = await ethers.getSigners();

      const Vault = await ethers.getContractFactory("VulnerableVaultFixture", deployer);
      const vault = await Vault.deploy();
      await vault.waitForDeployment();

      await vault.connect(depositor).deposit({ value: ethers.parseEther("2") });
      const before = await ethers.provider.getBalance(drainRecipient.address);

      // Any non-owner can drain the vault
      await vault.connect(randomCaller).emergencyDrain(drainRecipient.address);

      const after = await ethers.provider.getBalance(drainRecipient.address);
      expect(after - before).to.equal(ethers.parseEther("2"));
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0);
    });
  });

  describe("SafeVaultFixture", function () {
    it("blocks reentrancy attack on withdraw()", async function () {
      const [deployer, innocentUser, attackerSigner] = await ethers.getSigners();

      const SafeVault = await ethers.getContractFactory("SafeVaultFixture", deployer);
      const safeVault = await SafeVault.deploy();
      await safeVault.waitForDeployment();

      await safeVault.connect(innocentUser).deposit({ value: ethers.parseEther("5") });

      const Attacker = await ethers.getContractFactory("ReentrancyAttackerFixture", attackerSigner);
      const attacker = await Attacker.deploy(await safeVault.getAddress());
      await attacker.waitForDeployment();

      await expect(
        attacker.connect(attackerSigner).attack({ value: ethers.parseEther("1") })
      ).to.be.reverted;

      expect(await ethers.provider.getBalance(await safeVault.getAddress())).to.equal(
        ethers.parseEther("5")
      );
    });

    it("blocks non-owner from calling emergencyDrain() and enforces pause", async function () {
      const [deployer, user, randomCaller] = await ethers.getSigners();

      const SafeVault = await ethers.getContractFactory("SafeVaultFixture", deployer);
      const safeVault = await SafeVault.deploy();
      await safeVault.waitForDeployment();

      await expect(
        safeVault.connect(randomCaller).emergencyDrain(randomCaller.address)
      ).to.be.revertedWithCustomError(safeVault, "NotOwner");

      await safeVault.connect(deployer).setPaused(true);
      await expect(
        safeVault.connect(user).deposit({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(safeVault, "ContractPaused");
    });
  });
});

