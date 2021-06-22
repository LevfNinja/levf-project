// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");
const inquirer = require("inquirer");
const deployUtil = require("./deployUtil");

require("dotenv").config();

async function main() {
  const answers = await inquirer.prompt([
    {
      name: "treasuryPoolAddress",
      type: "input",
      message: "Please provide the treasury pool address for the farming pool to be deployed:",
      validate: (value) => {
        const isValid = hre.ethers.utils.isAddress(value);
        if (!isValid) {
          console.log(" ❌");
        }
        return isValid;
      },
    },
  ]);
  await deploy(answers.treasuryPoolAddress);
}

async function deploy(treasuryPoolAddress) {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const network = hre.network.name;
  const accounts = await hre.ethers.getSigners();
  const Btoken = await hre.ethers.getContractFactory("Btoken");
  const UnderlyingAssetMock = await hre.ethers.getContractFactory("UnderlyingAssetMock");
  const TreasuryPool = await hre.ethers.getContractFactory("TreasuryPool");
  const FarmingPool = await hre.ethers.getContractFactory("FarmingPool");
  const YearnVaultV2Mock = await hre.ethers.getContractFactory("YearnVaultV2Mock");
  const YvdaiAdapter = await hre.ethers.getContractFactory("YvdaiAdapter");
  const ropstenUnderlyingAssetAddress = process.env.ROPSTEN_DAI_ADDRESS ?? deployUtil.references.addresses.dai.ropsten;
  const kovanUnderlyingAssetAddress = process.env.KOVAN_DAI_ADDRESS ?? deployUtil.references.addresses.dai.kovan;
  const mainnetUnderlyingAssetAddress = deployUtil.references.addresses.dai.mainnet;
  const bscTestnetUnderlyingAssetAddress = deployUtil.references.addresses.dai["bsc-testnet"];
  const ropstenYvdaiAddress = process.env.ROPSTEN_YVDAI_ADDRESS;
  const kovanYvdaiAddress = process.env.KOVAN_YVDAI_ADDRESS;
  const mainnetYvdaiAddress = deployUtil.references.addresses.yvdai.mainnet;
  const bscTestnetYvdaiAddress = process.env.BSC_TESTNET_YVDAI_ADDRESS;

  const btokenArguments = ["BDai Token", "BDai"];
  const btoken = await deployUtil.deployContract(Btoken, btokenArguments, true);
  let treasuryPool = TreasuryPool.attach(treasuryPoolAddress);
  let farmingPoolArguments;
  let farmingPool;
  let yvdaiAdapterArguments;
  let yvdaiAdapter;

  let underlyingAssetAddress;
  let yvdaiAddress;
  let insuranceFundAddress;
  let leverageFactor;
  let liquidityPenalty;
  let taxRate;

  let isLiveNetwork = true;
  if (network === "mainnet") {
    underlyingAssetAddress = mainnetUnderlyingAssetAddress;
    yvdaiAddress = mainnetYvdaiAddress;
    insuranceFundAddress = process.env.MAINNET_INSURANCE_FUND_ADDRESS;
    leverageFactor = 20;
    liquidityPenalty = 10;
    taxRate = 10;
  } else if (network === "ropsten") {
    underlyingAssetAddress = ropstenUnderlyingAssetAddress;
    yvdaiAddress = ropstenYvdaiAddress;
    insuranceFundAddress = process.env.ROPSTEN_INSURANCE_FUND_ADDRESS;
    leverageFactor = 20;
    liquidityPenalty = 10;
    taxRate = 10;
  } else if (network === "kovan") {
    underlyingAssetAddress = kovanUnderlyingAssetAddress;
    yvdaiAddress = kovanYvdaiAddress;
    insuranceFundAddress = process.env.KOVAN_INSURANCE_FUND_ADDRESS;
    leverageFactor = 20;
    liquidityPenalty = 10;
    taxRate = 10;
  } else if (network === "bsc-testnet") {
    underlyingAssetAddress = bscTestnetUnderlyingAssetAddress;
    yvdaiAddress = bscTestnetYvdaiAddress;
    insuranceFundAddress = process.env.BSC_TESTNET_INSURANCE_FUND_ADDRESS;
    leverageFactor = 20;
    liquidityPenalty = 10;
    taxRate = 10;
  } else if (network === "localhost" || network === "yearn-mainnet-fork") {
    isLiveNetwork = false;
    if (network === "yearn-mainnet-fork") {
      underlyingAssetAddress = mainnetUnderlyingAssetAddress;
      yvdaiAddress = mainnetYvdaiAddress;
    } else if (network === "localhost") {
      const underlyingAssetMockArguments = ["UnderlyingAsset Mock", "UnderlyingAsset Mock"];
      const underlyingAssetMock = await deployUtil.deployContract(
        UnderlyingAssetMock,
        underlyingAssetMockArguments,
        false
      );
      await underlyingAssetMock.deployed();
      underlyingAssetAddress = underlyingAssetMock.address;

      const yearnVaultV2MockArguments = [underlyingAssetAddress];
      const yearnVaultV2Mock = await deployUtil.deployContract(YearnVaultV2Mock, yearnVaultV2MockArguments, false);
      await yearnVaultV2Mock.deployed();
      yvdaiAddress = yearnVaultV2Mock.address;
    }
    insuranceFundAddress = accounts[2].address;
    leverageFactor = 20;
    liquidityPenalty = 10;
    taxRate = 10;
  } else {
    throw new Error(`Unknown network: ${network}`);
  }

  if (underlyingAssetAddress === undefined) {
    throw new Error("Unknown underlying asset address");
  } else if (yvdaiAddress === undefined) {
    throw new Error("Unknown yvDAI address");
  } else if (insuranceFundAddress === undefined) {
    throw new Error("Unknown insurance fund address");
  } else if (leverageFactor === undefined) {
    throw new Error("Unknown leverage factor");
  } else if (liquidityPenalty === undefined) {
    throw new Error("Unknown liquidity penalty");
  } else if (taxRate === undefined) {
    throw new Error("Unknown taxRate");
  }

  farmingPoolArguments = [
    "Yearn DAI Vault",
    underlyingAssetAddress,
    btoken.address,
    treasuryPool.address,
    insuranceFundAddress,
    leverageFactor,
    liquidityPenalty,
    taxRate,
  ];
  farmingPool = await deployUtil.deployContract(FarmingPool, farmingPoolArguments, true);

  yvdaiAdapterArguments = [
    underlyingAssetAddress, //
    yvdaiAddress,
    farmingPool.address,
  ];
  yvdaiAdapter = await deployUtil.deployContract(YvdaiAdapter, yvdaiAdapterArguments, true);

  await btoken.deployed();
  await farmingPool.deployed();
  await yvdaiAdapter.deployed();
  console.log("BDai deployed to:", btoken.address);
  console.log("FarmingPool deployed to:", farmingPool.address);
  console.log("YvdaiAdapter deployed to:", yvdaiAdapter.address);

  // Verify the source code if it is deployed to live networks
  if (isLiveNetwork) {
    await deployUtil.tryVerifyContract(btoken, btokenArguments);
    await deployUtil.tryVerifyContract(farmingPool, farmingPoolArguments);
    await deployUtil.tryVerifyContract(yvdaiAdapter, yvdaiAdapterArguments);
  }

  // Post-Deployment
  await btoken.setFarmingPoolAddress(farmingPool.address);
  await treasuryPool.addFarmingPoolAddress(farmingPool.address);
  await farmingPool.setAdapterAddress(yvdaiAdapter.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
