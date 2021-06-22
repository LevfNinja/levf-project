const assert = require("assert");
const { expectEvent, expectRevert } = require("@openzeppelin/test-helpers");
const { BN, ether, ZERO_ADDRESS, ...testUtil } = require("./testUtil");

describe("YvdaiAdapter", () => {
  let accounts;
  let defaultGovernanceAccount;
  let defaultFarmingPoolAddress;
  let underlyingAsset;
  let yvdai;
  let yvdaiAdapter;

  before(async () => {
    accounts = await web3.eth.getAccounts();
    defaultGovernanceAccount = accounts[0];
    defaultFarmingPoolAddress = accounts[5];
  });

  beforeEach(async () => {
    underlyingAsset = await testUtil.newUnderlyingAssetMock();
    yvdai = await testUtil.newYearnVaultV2Mock(underlyingAsset.address);
    yvdaiAdapter = await testUtil.newYvdaiAdapter(underlyingAsset.address, yvdai.address, defaultFarmingPoolAddress);
  });

  it("should be initialized correctly", async () => {
    const governanceAccount = await yvdaiAdapter.governanceAccount();
    const underlyingAssetAddress = await yvdaiAdapter.underlyingAssetAddress();
    const programAddress = await yvdaiAdapter.programAddress();
    const farmingPoolAddress = await yvdaiAdapter.farmingPoolAddress();

    const expectGovernanceAccount = defaultGovernanceAccount;
    const expectUnderlyingAssetAddress = underlyingAsset.address;
    const expectProgramAddress = yvdai.address;
    const expectFarmingPoolAddress = defaultFarmingPoolAddress;

    await expectRevert(
      testUtil.newYvdaiAdapter(ZERO_ADDRESS, yvdai.address, farmingPoolAddress),
      "YvdaiAdapter: underlying asset address is the zero address"
    );
    await expectRevert(
      testUtil.newYvdaiAdapter(underlyingAsset.address, ZERO_ADDRESS, farmingPoolAddress),
      "YvdaiAdapter: yvDai address is the zero address"
    );
    await expectRevert(
      testUtil.newYvdaiAdapter(underlyingAsset.address, yvdai.address, ZERO_ADDRESS),
      "YvdaiAdapter: farming pool address is the zero address"
    );

    assert.strictEqual(
      governanceAccount,
      expectGovernanceAccount,
      `Governance account is ${governanceAccount} instead of treasury pool creator address ${expectGovernanceAccount}`
    );
    assert.strictEqual(
      underlyingAssetAddress,
      expectUnderlyingAssetAddress,
      `Underlying asset address is ${underlyingAssetAddress} instead of ${expectUnderlyingAssetAddress}`
    );
    assert.strictEqual(
      programAddress,
      expectProgramAddress,
      `Program address is ${programAddress} instead of ${expectProgramAddress}`
    );
    assert.strictEqual(
      farmingPoolAddress,
      expectFarmingPoolAddress,
      `Farming pool address is ${farmingPoolAddress} instead of ${expectFarmingPoolAddress}`
    );
  });

  it("should only allow farming pool to deposit", async () => {
    const nonFarmingPoolAddress = accounts[6];

    const depositAmount = ether("9.9");

    await expectRevert(
      depositUnderlyingToken(depositAmount, nonFarmingPoolAddress),
      "YvdaiAdapter: sender not authorized"
    );
    await assert.doesNotReject(async () => await depositUnderlyingToken(depositAmount, defaultFarmingPoolAddress));
  });

  it("should not allow to deposit 0", async () => {
    await expectRevert(depositUnderlyingToken(ether("0"), defaultFarmingPoolAddress), "YvdaiAdapter: can't add 0");
  });

  it("should be able to deposit", async () => {
    const firstDepositAmount = ether("1.1");
    const secondDepositAmount = ether("1");

    const firstReceipt = await depositUnderlyingToken(firstDepositAmount, defaultFarmingPoolAddress);
    const secondReceipt = await depositUnderlyingToken(secondDepositAmount, defaultFarmingPoolAddress);

    const yvdaiBalance = await yvdai.balanceOf(yvdaiAdapter.address);
    const totalRedeemableUnderlyingTokens = await yvdaiAdapter.getTotalRedeemableUnderlyingTokens();
    const firstWrappedTokenQuantity = firstReceipt.logs[0].args.wrappedTokenQuantity;
    const secondWrappedTokenQuantity = secondReceipt.logs[0].args.wrappedTokenQuantity;
    const firstDepositingTimestamp = await testUtil.getBlockTimestamp(firstReceipt.receipt.blockHash);
    const secondDepositingTimestamp = await testUtil.getBlockTimestamp(secondReceipt.receipt.blockHash);

    const expectYvdaiBalance = firstDepositAmount.add(secondDepositAmount);

    assert.ok(yvdaiBalance.eq(expectYvdaiBalance), `yvDAI balance is ${yvdaiBalance} instead of ${expectYvdaiBalance}`);
    assert.ok(
      totalRedeemableUnderlyingTokens.gt(ether("0")),
      "total redeemable underlying tokens should be greater than 0"
    );
    assert.ok(firstWrappedTokenQuantity.gt(ether("0")), `The first wrapped token quantity should be grater than 0`);
    assert.ok(secondWrappedTokenQuantity.gt(ether("0")), `The second wrapped token quantity should be grater than 0`);
    expectEvent(firstReceipt, "DepositUnderlyingToken", {
      underlyingAssetAddress: underlyingAsset.address,
      wrappedTokenAddress: yvdai.address,
      underlyingAssetAmount: firstDepositAmount,
      operator: defaultFarmingPoolAddress,
      timestamp: firstDepositingTimestamp,
    });
    expectEvent(secondReceipt, "DepositUnderlyingToken", {
      underlyingAssetAddress: underlyingAsset.address,
      wrappedTokenAddress: yvdai.address,
      underlyingAssetAmount: secondDepositAmount,
      operator: defaultFarmingPoolAddress,
      timestamp: secondDepositingTimestamp,
    });
  });

  it("should only allow farming pool to redeem", async () => {
    const nonFarmingPoolAddress = accounts[6];

    const depositAmount = ether("9.9");
    await depositUnderlyingToken(depositAmount, defaultFarmingPoolAddress);

    await expectRevert(
      yvdaiAdapter.redeemWrappedToken(depositAmount, { from: nonFarmingPoolAddress }),
      "YvdaiAdapter: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await yvdaiAdapter.redeemWrappedToken(depositAmount, { from: defaultFarmingPoolAddress })
    );
  });

  it("should not allow to redeem 0", async () => {
    const depositAmount = ether("9.9");
    await depositUnderlyingToken(depositAmount, defaultFarmingPoolAddress);

    await expectRevert(
      yvdaiAdapter.redeemWrappedToken(ether("0"), { from: defaultFarmingPoolAddress }),
      "YvdaiAdapter: can't redeem 0"
    );
  });

  it("should be able to redeem", async () => {
    const depositAmount = ether("9.9");
    await depositUnderlyingToken(depositAmount, defaultFarmingPoolAddress);

    const firstRedeemAmount = ether("1.1");
    const secondRedeemAmount = ether("1");

    const firstReceipt = await yvdaiAdapter.redeemWrappedToken(firstRedeemAmount, { from: defaultFarmingPoolAddress });
    const secondReceipt = await yvdaiAdapter.redeemWrappedToken(secondRedeemAmount, {
      from: defaultFarmingPoolAddress,
    });

    const yvdaiBalance = await yvdai.balanceOf(yvdaiAdapter.address);
    const firstActualWrappedTokenAmount = firstReceipt.logs[0].args.actualWrappedTokenAmount;
    const secondActualWrappedTokenAmount = secondReceipt.logs[0].args.actualWrappedTokenAmount;
    const firstUnderlyingAssetQuantity = firstReceipt.logs[0].args.underlyingAssetQuantity;
    const secondUnderlyingAssetQuantity = secondReceipt.logs[0].args.underlyingAssetQuantity;
    const firstRedeemingTimestamp = await testUtil.getBlockTimestamp(firstReceipt.receipt.blockHash);
    const secondRedeemingTimestamp = await testUtil.getBlockTimestamp(secondReceipt.receipt.blockHash);

    const expectYvdaiBalance = depositAmount.sub(firstActualWrappedTokenAmount).sub(secondActualWrappedTokenAmount);

    assert.ok(yvdaiBalance.eq(expectYvdaiBalance), `yvDAI balance is ${yvdaiBalance} instead of ${expectYvdaiBalance}`);
    assert.ok(
      firstUnderlyingAssetQuantity.gt(ether("0")),
      `The first underlying asset quantity should be grater than 0`
    );
    assert.ok(
      secondUnderlyingAssetQuantity.gt(ether("0")),
      `The second underlying asset quantity should be grater than 0`
    );
    expectEvent(firstReceipt, "RedeemWrappedToken", {
      underlyingAssetAddress: underlyingAsset.address,
      wrappedTokenAddress: yvdai.address,
      maxWrappedTokenAmount: firstRedeemAmount,
      operator: defaultFarmingPoolAddress,
      timestamp: firstRedeemingTimestamp,
    });
    expectEvent(secondReceipt, "RedeemWrappedToken", {
      underlyingAssetAddress: underlyingAsset.address,
      wrappedTokenAddress: yvdai.address,
      maxWrappedTokenAmount: secondRedeemAmount,
      operator: defaultFarmingPoolAddress,
      timestamp: secondRedeemingTimestamp,
    });
  });

  it("should be able failed to call getWrappedTokenPriceInUnderlying if yvDAI uses unsupported decimals", async () => {
    await yvdai.testUpdateDecimals(19);

    await expectRevert(yvdaiAdapter.getWrappedTokenPriceInUnderlying(), "YvdaiAdapter: greater than 18 decimal places");
  });

  it("should be able to call getWrappedTokenPriceInUnderlying at the initial stage", async () => {
    await assert.doesNotReject(async () => await yvdaiAdapter.getWrappedTokenPriceInUnderlying());
  });

  it("should be able to call getWrappedTokenPriceInUnderlying after deposit", async () => {
    const depositAmount = ether("9.9");
    await depositUnderlyingToken(depositAmount, defaultFarmingPoolAddress);

    await assert.doesNotReject(async () => await yvdaiAdapter.getWrappedTokenPriceInUnderlying());
  });

  it("should be able failed to call getRedeemableUnderlyingTokensFor if yvDAI uses unsupported decimals", async () => {
    await yvdai.testUpdateDecimals(19);

    await expectRevert(
      yvdaiAdapter.getRedeemableUnderlyingTokensFor(ether("1")),
      "YvdaiAdapter: greater than 18 decimal places"
    );
  });

  it("should return correctly from getRedeemableUnderlyingTokensFor", async () => {
    const depositAmount = ether("9.9");
    const redeemAmount = ether("1");

    const priceInitialStage = await yvdaiAdapter.getWrappedTokenPriceInUnderlying();
    const redeemableUnderlyingTokensInitialStage = await yvdaiAdapter.getRedeemableUnderlyingTokensFor(redeemAmount);

    await depositUnderlyingToken(depositAmount, defaultFarmingPoolAddress);
    const priceAfterDeposit = await yvdaiAdapter.getWrappedTokenPriceInUnderlying();
    const redeemableUnderlyingTokensAfterDeposit = await yvdaiAdapter.getRedeemableUnderlyingTokensFor(redeemAmount);

    const expectRedeemableUnderlyingTokensInitialStage = redeemAmount
      .mul(priceInitialStage)
      .div(new BN(10).pow(new BN(18)));
    const expectRedeemableUnderlyingTokensAfterDeposit = redeemAmount
      .mul(priceAfterDeposit)
      .div(new BN(10).pow(new BN(18)));

    assert.ok(
      redeemableUnderlyingTokensInitialStage.eq(expectRedeemableUnderlyingTokensInitialStage),
      `Redeemable underlying tokens at the initial stage are ${redeemableUnderlyingTokensInitialStage} instead of ${expectRedeemableUnderlyingTokensInitialStage}`
    );
    assert.ok(
      redeemableUnderlyingTokensAfterDeposit.eq(expectRedeemableUnderlyingTokensAfterDeposit),
      `Redeemable underlying tokens after deposit are ${redeemableUnderlyingTokensAfterDeposit} instead of ${expectRedeemableUnderlyingTokensAfterDeposit}`
    );
  });

  it("should only allow governance account to change governance account", async () => {
    const nonGovernanceAccount = accounts[6];

    await expectRevert(
      yvdaiAdapter.setGovernanceAccount(nonGovernanceAccount, { from: nonGovernanceAccount }),
      "YvdaiAdapter: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await yvdaiAdapter.setGovernanceAccount(defaultGovernanceAccount, { from: defaultGovernanceAccount })
    );
  });

  it("should be changed to the specific governance account", async () => {
    const expectNewGovernanceAccount = accounts[6];

    await yvdaiAdapter.setGovernanceAccount(expectNewGovernanceAccount, { from: defaultGovernanceAccount });
    const newGovernanceAccount = await yvdaiAdapter.governanceAccount();

    await expectRevert(
      yvdaiAdapter.setGovernanceAccount(ZERO_ADDRESS, { from: newGovernanceAccount }),
      "YvdaiAdapter: new governance account is the zero address"
    );
    assert.strictEqual(
      newGovernanceAccount,
      expectNewGovernanceAccount,
      `New governance account is ${newGovernanceAccount} instead of ${expectNewGovernanceAccount}`
    );
  });

  it("should only allow governance account to change farming pool address", async () => {
    const nonGovernanceAccount = accounts[6];
    const farmingPoolAddress = accounts[7];

    await expectRevert(
      yvdaiAdapter.setFarmingPoolAddress(farmingPoolAddress, { from: nonGovernanceAccount }),
      "YvdaiAdapter: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await yvdaiAdapter.setFarmingPoolAddress(farmingPoolAddress, { from: defaultGovernanceAccount })
    );
  });

  it("should be changed to the specific farming pool address", async () => {
    const expectNewFarmingPoolAddress = accounts[6];

    await yvdaiAdapter.setFarmingPoolAddress(expectNewFarmingPoolAddress, { from: defaultGovernanceAccount });
    const newFarmingPoolAddress = await yvdaiAdapter.farmingPoolAddress();

    await expectRevert(
      yvdaiAdapter.setFarmingPoolAddress(ZERO_ADDRESS, { from: defaultGovernanceAccount }),
      "YvdaiAdapter: new farming pool address is the zero address"
    );
    assert.strictEqual(
      newFarmingPoolAddress,
      expectNewFarmingPoolAddress,
      `New farming pool address is ${newFarmingPoolAddress} instead of ${expectNewFarmingPoolAddress}`
    );
  });

  async function depositUnderlyingToken(amount, farmingPoolAddress) {
    await underlyingAsset.mint(farmingPoolAddress, amount, { from: defaultGovernanceAccount });
    await underlyingAsset.approve(yvdaiAdapter.address, amount, { from: farmingPoolAddress });
    return await yvdaiAdapter.depositUnderlyingToken(amount, { from: farmingPoolAddress });
  }
});
