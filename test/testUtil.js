const BN = web3.utils.BN;
const BN_ZERO = new BN("0");
const BN_ONE = new BN("1");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function ether(ether) {
  return new BN(web3.utils.toWei(ether, "ether"));
}

function wei(wei) {
  return new BN(web3.utils.fromWei(wei, "wei"));
}

async function getBlockTimestamp(blockHashOrBlockNumber) {
  const block = await web3.eth.getBlock(blockHashOrBlockNumber);
  return new BN(block.timestamp);
}

function bnAbsDiff(bn1, bn2) {
  return bn1.gt(bn2) ? bn1.sub(bn2) : bn2.sub(bn1);
}

async function estimateLfiBalanceAfterTransfer(lfi, sender, recipient, amount, account = undefined) {
  const excludedAccounts = await lfi.excludedAccounts();
  const totalSupply = await lfi.totalSupply();
  const feePercentage = await lfi.feePercentage();
  const balanceOfSenderBeforeTransfer = await lfi.balanceOf(sender);
  const balanceOfRecipientBeforeTransfer = await lfi.balanceOf(recipient);

  const fee = amount.mul(feePercentage).div(new BN(100));
  const transferAmount = amount.sub(fee);
  let excludedAmount = new BN(0);
  for (let i = 0; i < excludedAccounts.length; i++) {
    excludedAmount = excludedAmount.add(await lfi.balanceOf(excludedAccounts[i]));
  }
  if (excludedAccounts.includes(sender)) {
    excludedAmount = excludedAmount.sub(amount);
  }
  if (excludedAccounts.includes(recipient)) {
    excludedAmount = excludedAmount.add(transferAmount);
  }

  const reflect = (account, amount) => {
    return !excludedAccounts.includes(account)
      ? amount.add(fee.mul(amount).div(totalSupply.sub(excludedAmount).sub(fee)))
      : amount;
  };

  const amountOfSenderBeforeReflect = balanceOfSenderBeforeTransfer.sub(amount);
  const amountOfRecipientBeforeReflect = balanceOfRecipientBeforeTransfer.add(transferAmount);
  const balanceOfSenderAfterTransfer = reflect(sender, amountOfSenderBeforeReflect);
  const balanceOfRecipientAfterTransfer = reflect(recipient, amountOfRecipientBeforeReflect);
  const balance = {
    sender: balanceOfSenderAfterTransfer,
    recipient: balanceOfRecipientAfterTransfer,
  };
  return account ? balance[account] : balance;
}

async function newLfi(name, symbol, cap, feePercentage, teamPreMinted, teamAccount) {
  const accounts = await web3.eth.getAccounts();
  const defaults = {
    name: "Levf Finance",
    symbol: "LFI",
    cap: ether("100000"),
    feePercentage: 10,
    teamPreMinted: ether("10000"),
    teamAccount: accounts[1],
  };

  const Lfi = artifacts.require("Lfi");
  const actualName = await getDefinedOrDefault(name, () => defaults.name);
  const actualSymbol = await getDefinedOrDefault(symbol, () => defaults.symbol);
  const actualCap = await getDefinedOrDefault(cap, () => defaults.cap);
  const actualFeePercentage = await getDefinedOrDefault(feePercentage, () => defaults.feePercentage);
  const actualTeamPreMinted = await getDefinedOrDefault(teamPreMinted, () => defaults.teamPreMinted);
  const actualTeamAccount = await getDefinedOrDefault(teamAccount, () => defaults.teamAccount);

  return await Lfi.new(
    actualName,
    actualSymbol,
    actualCap,
    actualFeePercentage,
    actualTeamPreMinted,
    actualTeamAccount
  );
}

async function newUnderlyingAssetMock(name, symbol) {
  const defaults = {
    name: "UnderlyingAsset Mock",
    symbol: "UnderlyingAsset Mock",
  };

  const UnderlyingAssetMock = artifacts.require("UnderlyingAssetMock");
  const actualName = await getDefinedOrDefault(name, () => defaults.name);
  const actualSymbol = await getDefinedOrDefault(symbol, () => defaults.symbol);

  return await UnderlyingAssetMock.new(actualName, actualSymbol);
}

async function newBtoken(name, symbol) {
  const defaults = {
    name: "BToken",
    symbol: "BToken",
  };

  const Btoken = artifacts.require("Btoken");
  const actualName = await getDefinedOrDefault(name, () => defaults.name);
  const actualSymbol = await getDefinedOrDefault(symbol, () => defaults.symbol);

  return await Btoken.new(actualName, actualSymbol);
}

async function newErc20Ltoken(name, symbol) {
  const defaults = {
    name: "Erc20Ltoken",
    symbol: "Erc20Ltoken",
  };

  const Erc20Ltoken = artifacts.require("Erc20Ltoken");
  const actualName = await getDefinedOrDefault(name, () => defaults.name);
  const actualSymbol = await getDefinedOrDefault(symbol, () => defaults.symbol);

  return await Erc20Ltoken.new(actualName, actualSymbol);
}

async function newDsecDistribution(epoch0StartTimestamp, epochDuration, intervalBetweenEpochs, totalNumberOfEpochs) {
  const defaults = {
    totalNumberOfEpochs: 10,
    epoch0StartTimestamp: 1641686400,
    epochDuration: 14 * 86400,
    intervalBetweenEpochs: 86400,
  };

  const DsecDistribution = artifacts.require("DsecDistribution");
  const actualTotalNumberOfEpochs = await getDefinedOrDefault(totalNumberOfEpochs, () => defaults.totalNumberOfEpochs);
  const actualEpoch0StartTimestamp = await getDefinedOrDefault(
    epoch0StartTimestamp,
    () => defaults.epoch0StartTimestamp
  );
  const actualEpochDuration = await getDefinedOrDefault(epochDuration, () => defaults.epochDuration);
  const actualIntervalBetweenEpochs = await getDefinedOrDefault(
    intervalBetweenEpochs,
    () => defaults.intervalBetweenEpochs
  );

  return await DsecDistribution.new(
    actualTotalNumberOfEpochs,
    actualEpoch0StartTimestamp,
    actualEpochDuration,
    actualIntervalBetweenEpochs
  );
}

async function newFarmingPool(
  name,
  underlyingAssetAddress,
  btokenAddress,
  treasuryPoolAddress,
  insuranceFundAddress,
  leverageFactor,
  liquidityPenalty,
  taxRate
) {
  const accounts = await web3.eth.getAccounts();
  const defaults = {
    name: "Yearn DAI Vault",
    insuranceFundAccount: accounts[2],
    leverageFactor: 20,
    liquidityPenalty: 10,
    taxRate: 10,
  };

  const FarmingPool = artifacts.require("FarmingPool");
  const actualUnderlyingAssetAddress = await getDefinedOrDefault(underlyingAssetAddress, async () => {
    const underlyingAssetMock = await newUnderlyingAssetMock();
    return underlyingAssetMock.address;
  });
  const actualBtokenAddress = await getDefinedOrDefault(btokenAddress, async () => {
    const btoken = await newBtoken();
    return btoken.address;
  });
  const actualTreasuryPoolAddress = await getDefinedOrDefault(treasuryPoolAddress, async () => {
    const treasuryPool = await newTreasuryPool();
    return treasuryPool.address;
  });
  const actualName = await getDefinedOrDefault(name, async () => defaults.name);
  const actualInsuranceFundAddress = await getDefinedOrDefault(
    insuranceFundAddress,
    () => defaults.insuranceFundAddress
  );
  /*
  const actualInsuranceFundAddress = await getDefinedOrDefault(insuranceFundAddress, async () => {
    const insuranceFund = await newInsuranceFund();
    return insuranceFund.address;
  });
  */
  const actualLeverageFactor = await getDefinedOrDefault(leverageFactor, () => defaults.leverageFactor);
  const actualLiquidityPenalty = await getDefinedOrDefault(liquidityPenalty, () => defaults.liquidityPenalty);
  const actualTaxRate = await getDefinedOrDefault(taxRate, () => defaults.taxRate);

  return await FarmingPool.new(
    actualName,
    actualUnderlyingAssetAddress,
    actualBtokenAddress,
    actualTreasuryPoolAddress,
    actualInsuranceFundAddress,
    actualLeverageFactor,
    actualLiquidityPenalty,
    actualTaxRate
  );
}

async function newTreasuryPool(
  lfiAddress,
  underlyingAssetAddress,
  ltokenAddress,
  dsecDistributionAddress,
  lpRewardPerEpoch,
  teamRewardPerEpoch,
  teamAccount
) {
  const accounts = await web3.eth.getAccounts();
  const defaults = {
    lpRewardPerEpoch: ether("6000"),
    teamRewardPerEpoch: ether("1500"),
    teamAccount: accounts[1],
  };

  const TreasuryPool = artifacts.require("TreasuryPool");
  const actualLfiAddress = await getDefinedOrDefault(lfiAddress, async () => {
    const lfi = await newLfi();
    return lfi.address;
  });
  const actualUnderlyingAssetAddress = await getDefinedOrDefault(underlyingAssetAddress, async () => {
    const underlyingAssetMock = await newUnderlyingAssetMock();
    return underlyingAssetMock.address;
  });
  const actualLtokenAddress = await getDefinedOrDefault(ltokenAddress, async () => {
    const ltoken = await newErc20Ltoken();
    return ltoken.address;
  });
  const actualDsecDistributionAddress = await getDefinedOrDefault(dsecDistributionAddress, async () => {
    const dsecDistribution = await newDsecDistribution();
    return dsecDistribution.address;
  });
  const actualLpRewardPerEpoch = await getDefinedOrDefault(lpRewardPerEpoch, () => defaults.lpRewardPerEpoch);
  const actualTeamRewardPerEpoch = await getDefinedOrDefault(teamRewardPerEpoch, () => defaults.teamRewardPerEpoch);
  const actualTeamAccount = await getDefinedOrDefault(teamAccount, () => defaults.teamAccount);

  return await TreasuryPool.new(
    actualLfiAddress,
    actualUnderlyingAssetAddress,
    actualLtokenAddress,
    actualDsecDistributionAddress,
    actualLpRewardPerEpoch,
    actualTeamRewardPerEpoch,
    actualTeamAccount
  );
}

async function newYearnVaultV2Mock(underlyingAssetAddress) {
  const yearnVaultV2Mock = artifacts.require("YearnVaultV2Mock");
  const actualUnderlyingAssetAddress = await getDefinedOrDefault(underlyingAssetAddress, async () => {
    const underlyingAssetMock = await newUnderlyingAssetMock();
    return underlyingAssetMock.address;
  });
  return await yearnVaultV2Mock.new(actualUnderlyingAssetAddress);
}

async function newYvdaiAdapter(underlyingAssetAddress, yearnVaultV2Address, farmingPoolAddress) {
  const yvdaiAdapter = artifacts.require("YvdaiAdapter");
  const actualUnderlyingAssetAddress = await getDefinedOrDefault(underlyingAssetAddress, async () => {
    const underlyingAssetMock = await newUnderlyingAssetMock();
    return underlyingAssetMock.address;
  });
  const actualYearnVaultV2Address = await getDefinedOrDefault(yearnVaultV2Address, async () => {
    const yearnVaultV2Mock = await newYearnVaultV2Mock();
    return yearnVaultV2Mock.address;
  });
  return await yvdaiAdapter.new(actualUnderlyingAssetAddress, actualYearnVaultV2Address, farmingPoolAddress);
}

async function getDefinedOrDefault(value, defaultAsyncFn) {
  if (value !== undefined) {
    return value;
  } else {
    return await defaultAsyncFn();
  }
}

module.exports = {
  BN,
  BN_ZERO,
  BN_ONE,
  ether,
  wei,
  newLfi,
  newBtoken,
  newErc20Ltoken,
  newUnderlyingAssetMock,
  newDsecDistribution,
  newFarmingPool,
  newTreasuryPool,
  newYearnVaultV2Mock,
  newYvdaiAdapter,
  bnAbsDiff,
  getBlockTimestamp,
  estimateLfiBalanceAfterTransfer,
  ZERO_ADDRESS,
};
