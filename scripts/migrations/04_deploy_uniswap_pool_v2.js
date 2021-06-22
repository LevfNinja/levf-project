// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const fs = require("fs/promises");
const path = require("path");
const hre = require("hardhat");
const deployUtil = require("./deployUtil");

require("dotenv").config();

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const projectRootPath = path.dirname(path.dirname(__dirname));
  const projectTempPath = path.join(projectRootPath, "tmp");

  const network = hre.network.name;
  const accounts = await hre.ethers.getSigners();
  const Erc20Ltoken = await hre.ethers.getContractFactory("Erc20Ltoken");
  const DsecDistribution = await hre.ethers.getContractFactory("DsecDistribution");
  const UnderlyingAssetMock = await hre.ethers.getContractFactory("UnderlyingAssetMock");
  const TreasuryPool = await hre.ethers.getContractFactory("TreasuryPool");
  const ropstenUnderlyingAssetAddress = process.env.ROPSTEN_UNISWAP_DAI_LFI_UNI_ADDRESS;
  const kovanUnderlyingAssetAddress = process.env.KOVAN_UNISWAP_DAI_LFI_UNI_ADDRESS;
  const mainnetUnderlyingAssetAddress = process.env.MAINNET_UNISWAP_DAI_LFI_UNI_ADDRESS;

  const ltokenArguments = ["LUniLp Token", "LUniLp"];
  const ltoken = await deployUtil.deployContract(Erc20Ltoken, ltokenArguments, true);
  let dsecDistributionArguments;
  let dsecDistribution;
  let treasuryPoolArguments;
  let treasuryPool;

  let lfiAddress;
  let underlyingAssetAddress;
  const lpRewardPerEpoch = hre.ethers.utils.parseEther("1500");
  const teamRewardPerEpoch = hre.ethers.utils.parseEther("0");
  let teamAccountAddress;

  let isLiveNetwork = true;
  if (network === "mainnet") {
    dsecDistributionArguments = [10, 1624435200, 14 * 86400, 86400];
    lfiAddress = process.env.MAINNET_LFI_ADDRESS;
    underlyingAssetAddress = mainnetUnderlyingAssetAddress;
    teamAccountAddress = process.env.MAINNET_TEAM_ACCOUNT;
  } else if (network === "ropsten") {
    dsecDistributionArguments = [10, 1641686400, 14 * 86400, 86400];
    lfiAddress = process.env.ROPSTEN_LFI_ADDRESS;
    underlyingAssetAddress = ropstenUnderlyingAssetAddress;
    teamAccountAddress = process.env.ROPSTEN_TEAM_ACCOUNT;
  } else if (network === "kovan") {
    dsecDistributionArguments = [10, 1641686400, 14 * 86400, 86400];
    lfiAddress = process.env.KOVAN_LFI_ADDRESS;
    underlyingAssetAddress = kovanUnderlyingAssetAddress;
    teamAccountAddress = process.env.KOVAN_TEAM_ACCOUNT;
  } else if (network === "localhost" || network === "yearn-mainnet-fork") {
    isLiveNetwork = false;
    dsecDistributionArguments = [10, 1641686400, 14 * 86400, 86400];
    lfiAddress = await fs.readFile(path.join(projectTempPath, "lfi_address.txt"), { encoding: "utf8" });
    if (network === "yearn-mainnet-fork") {
      underlyingAssetAddress = mainnetUnderlyingAssetAddress;
    } else if (network === "localhost") {
      const underlyingAssetMockArguments = ["UnderlyingAsset Mock", "UnderlyingAsset Mock"];
      const underlyingAssetMock = await deployUtil.deployContract(
        UnderlyingAssetMock,
        underlyingAssetMockArguments,
        false
      );
      await underlyingAssetMock.deployed();
      underlyingAssetAddress = underlyingAssetMock.address;
    }
    teamAccountAddress = accounts[1].address;
  } else {
    throw new Error(`Unknown network: ${network}`);
  }

  if (dsecDistributionArguments == undefined) {
    throw new Error("Unknown DsecDistribution arguments");
  } else if (lfiAddress === undefined) {
    throw new Error("Unknown Lfi address");
  } else if (underlyingAssetAddress === undefined) {
    throw new Error("Unknown underlying asset address");
  } else if (teamAccountAddress === undefined) {
    throw new Error("Unknown team account address");
  }

  dsecDistribution = await deployUtil.deployContract(DsecDistribution, dsecDistributionArguments, true);

  treasuryPoolArguments = [
    lfiAddress,
    underlyingAssetAddress,
    ltoken.address,
    dsecDistribution.address,
    lpRewardPerEpoch,
    teamRewardPerEpoch,
    teamAccountAddress,
  ];
  treasuryPool = await deployUtil.deployContract(TreasuryPool, treasuryPoolArguments, true);

  await ltoken.deployed();
  await dsecDistribution.deployed();
  await treasuryPool.deployed();
  console.log("LUniLp deployed to:", ltoken.address);
  console.log("DsecDistribution deployed to:", dsecDistribution.address);
  console.log("Uniswap LP Token Pool deployed to:", treasuryPool.address);

  // Verify the source code if it is deployed to live networks
  if (isLiveNetwork) {
    await deployUtil.tryVerifyContract(ltoken, ltokenArguments);
    await deployUtil.tryVerifyContract(dsecDistribution, dsecDistributionArguments);
    await deployUtil.tryVerifyContract(treasuryPool, treasuryPoolArguments);
  }

  // Post-Deployment
  const Lfi = await hre.ethers.getContractFactory("Lfi");
  const lfi = Lfi.attach(lfiAddress);
  await lfi.addTreasuryPoolAddress(treasuryPool.address);
  await ltoken.setTreasuryPoolAddress(treasuryPool.address);
  await dsecDistribution.setTreasuryPoolAddress(treasuryPool.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
