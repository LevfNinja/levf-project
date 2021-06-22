const hre = require("hardhat");

const references = {
  addresses: {
    dai: {
      "ropsten": "0xaD6D458402F60fD3Bd25163575031ACDce07538D",
      "kovan": "0x4F96Fe3b7A6Cf9725f59d353F723c1bDb64CA6Aa",
      "mainnet": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      "bsc-testnet": "0xEC5dCb5Dbf4B114C9d0F65BcCAb49EC54F6A0867",
    },
    yvdai: {
      mainnet: "0x19D3364A399d251E894aC732651be8B0E4e85001",
    },
  },
};

async function deployContract(contractFactory, constructorArguments, logConstructorArguments) {
  const contract = await contractFactory.deploy(...constructorArguments);

  if (logConstructorArguments) {
    console.log(`Arguments for the contract at ${contract.address}:`);
    constructorArguments.forEach((x) => console.log(`  - ${x.toString()}`));
  }

  return contract;
}

async function deployProxy(contractFactory, constructorArguments, logConstructorArguments) {
  const contract = await hre.upgrades.deployProxy(contractFactory, constructorArguments);

  if (logConstructorArguments) {
    console.log(`Arguments for the contract at ${contract.address}:`);
    constructorArguments.forEach((x) => console.log(`  - ${x.toString()}`));
  }

  return contract;
}

async function tryVerifyContract(contract, constructorArguments) {
  const explorer = [97, 56].includes(contract.deployTransaction.chainId)
    ? "BscScan(A product of Etherscan)"
    : "Etherscan";
  try {
    console.log(`Verifying the contract ${contract.address} on ${explorer} ...`);
    await hre.ethers.provider.waitForTransaction(contract.deployTransaction.hash, 5, 180000);
    await hre.run("verify:verify", {
      address: contract.address,
      constructorArguments: constructorArguments,
    });
  } catch (ex) {
    console.error(`An error has occurred during verifying on ${explorer}:\n`, ex);
    const network = hre.network.name;
    const quotedConstructorArguments = constructorArguments.map((x) => `"${x.toString().replace(/"/g, '\\"')}"`);
    const verifyCommand = `npx hardhat verify --network ${network} ${
      contract.address
    } ${quotedConstructorArguments.join(" ")}`;
    console.log(
      [
        `Failed to verify on ${explorer}, please run the following command to verify manually:`,
        "--------------------",
        verifyCommand,
        "--------------------",
      ].join("\n")
    );
    return false;
  }
}

module.exports = {
  references,
  deployContract,
  deployProxy,
  tryVerifyContract,
};
