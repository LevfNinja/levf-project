// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const fs = require("fs/promises");
const { existsSync } = require("fs");
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
  const Lfi = await hre.ethers.getContractFactory("Lfi");

  let isLiveNetwork = true;
  const cap = hre.ethers.utils.parseEther("100000");
  const feePercentage = 10;
  const teamPreMinted = hre.ethers.utils.parseEther("10000");
  let teamAccountAddress;

  if (network === "mainnet") {
    teamAccountAddress = process.env.MAINNET_TEAM_ACCOUNT;
  } else if (network === "ropsten") {
    teamAccountAddress = process.env.ROPSTEN_TEAM_ACCOUNT;
  } else if (network === "kovan") {
    teamAccountAddress = process.env.KOVAN_TEAM_ACCOUNT;
  } else if (network === "bsc-testnet") {
    teamAccountAddress = process.env.BSC_TESTNET_TEAM_ACCOUNT;
  } else if (network === "localhost" || network === "yearn-mainnet-fork") {
    isLiveNetwork = false;
    teamAccountAddress = accounts[1].address;
  } else {
    throw new Error(`Unknown network: ${network}`);
  }

  if (!teamAccountAddress) {
    throw new Error("Unknown team account address");
  }

  const lfiArguments = ["Levf Finance", "LFI", cap, feePercentage, teamPreMinted, teamAccountAddress];
  const lfi = await deployUtil.deployContract(Lfi, lfiArguments, true);

  await lfi.deployed();
  console.log("Lfi deployed to:", lfi.address);

  // Save Lfi address to temporary file for development networks
  if (!isLiveNetwork) {
    if (!existsSync(projectTempPath)) {
      await fs.mkdir(projectTempPath);
    }

    await fs.writeFile(path.join(projectTempPath, "lfi_address.txt"), lfi.address, { encoding: "utf8" });
  }

  // Verify the source code if it is deployed to live networks
  if (isLiveNetwork) {
    await deployUtil.tryVerifyContract(lfi, lfiArguments);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
