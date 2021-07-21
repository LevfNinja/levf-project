const assert = require("assert");
const timeMachine = require("ganache-time-traveler");
const { expectEvent, expectRevert, time } = require("@openzeppelin/test-helpers");
const { BN, BN_ZERO, BN_ONE, ether, wei, ZERO_ADDRESS, ...testUtil } = require("./testUtil");

const NewTreasuryPoolMock = artifacts.require("NewTreasuryPoolMock");

describe("TreasuryPool", () => {
  let accounts;
  let snapshotId;
  let defaultGovernanceAccount;
  let defaultTeamAccount;
  let lfi;
  let underlyingAsset;
  let ltoken;
  let dsecDistribution;
  let treasuryPool;

  before(async () => {
    accounts = await web3.eth.getAccounts();
    const snapshot = await timeMachine.takeSnapshot();
    snapshotId = snapshot["result"];
    defaultGovernanceAccount = accounts[0];
    defaultTeamAccount = accounts[1];
  });

  after(async () => {
    await timeMachine.revertToSnapshot(snapshotId);
  });

  beforeEach(async () => {
    const latestBlockTimestamp = await time.latest();
    const epoch0StartTimestamp = latestBlockTimestamp.add(time.duration.days(1));
    lfi = await testUtil.newLfi();
    underlyingAsset = await testUtil.newUnderlyingAssetMock();
    ltoken = await testUtil.newErc20Ltoken();
    dsecDistribution = await testUtil.newDsecDistribution(epoch0StartTimestamp);
    treasuryPool = await testUtil.newTreasuryPool(
      lfi.address,
      underlyingAsset.address,
      ltoken.address,
      dsecDistribution.address
    );
  });

  it("should be initialized correctly", async () => {
    const governanceAccount = await treasuryPool.governanceAccount();
    const lfiAddress = await treasuryPool.lfiAddress();
    const underlyingAssetAddress = await treasuryPool.underlyingAssetAddress();
    const ltokenAddress = await treasuryPool.ltokenAddress();
    const dsecDistributionAddress = await treasuryPool.dsecDistributionAddress();
    const lpRewardPerEpoch = await treasuryPool.lpRewardPerEpoch();
    const teamRewardPerEpoch = await treasuryPool.teamRewardPerEpoch();
    const teamAccount = await treasuryPool.teamAccount();
    const paused = await treasuryPool.paused();
    const initialTotalUnderlyingAssetAmount = await treasuryPool.totalUnderlyingAssetAmount();
    const initialTotalLtokenAmount = await treasuryPool.totalLtokenAmount();

    const expectGovernanceAccount = defaultGovernanceAccount;
    const expectLfiAddress = lfi.address;
    const expectUnderlyingAssetAddress = underlyingAsset.address;
    const expectLtokenAddress = ltoken.address;
    const expectDsecDistributionAddress = dsecDistribution.address;
    const expectLpRewardPerEpoch = ether("6000");
    const expectTeamRewardPerEpoch = ether("1500");
    const expectTeamAccount = defaultTeamAccount;
    const expectPaused = false;
    const expectInitialTotalUnderlyingAssetAmount = ether("0");
    const expectInitialTotalLtokenAmount = ether("0");

    await expectRevert(
      testUtil.newTreasuryPool(ZERO_ADDRESS, underlyingAsset.address, ltoken.address, dsecDistribution.address),
      "TreasuryPool: LFI address is the zero address"
    );
    await expectRevert(
      testUtil.newTreasuryPool(lfi.address, ZERO_ADDRESS, ltoken.address, dsecDistribution.address),
      "TreasuryPool: underlying asset address is the zero address"
    );
    await expectRevert(
      testUtil.newTreasuryPool(lfi.address, underlyingAsset.address, ZERO_ADDRESS, dsecDistribution.address),
      "TreasuryPool: LToken address is the zero address"
    );
    await expectRevert(
      testUtil.newTreasuryPool(lfi.address, underlyingAsset.address, ltoken.address, ZERO_ADDRESS),
      "TreasuryPool: dsec distribution address is the zero address"
    );
    await expectRevert(
      testUtil.newTreasuryPool(
        lfi.address,
        underlyingAsset.address,
        ltoken.address,
        dsecDistribution.address,
        undefined,
        undefined,
        ZERO_ADDRESS
      ),
      "TreasuryPool: team account is the zero address"
    );

    assert.strictEqual(
      governanceAccount,
      expectGovernanceAccount,
      `Governance account is ${governanceAccount} instead of treasury pool creator address ${expectGovernanceAccount}`
    );
    assert.strictEqual(lfiAddress, expectLfiAddress, `LFI address is ${lfiAddress} instead of ${expectLfiAddress}`);
    assert.strictEqual(
      underlyingAssetAddress,
      expectUnderlyingAssetAddress,
      `Underlying asset address is ${underlyingAssetAddress} instead of ${expectUnderlyingAssetAddress}`
    );
    assert.strictEqual(
      ltokenAddress,
      expectLtokenAddress,
      `LToken address is ${ltokenAddress} instead of ${expectLtokenAddress}`
    );
    assert.strictEqual(
      dsecDistributionAddress,
      expectDsecDistributionAddress,
      `DSec distributionAddress is ${dsecDistributionAddress} instead of ${expectDsecDistributionAddress}`
    );
    assert.ok(
      lpRewardPerEpoch.eq(expectLpRewardPerEpoch),
      `LP rewarded per epoch is ${lpRewardPerEpoch} instead of ${expectLpRewardPerEpoch}`
    );
    assert.ok(
      teamRewardPerEpoch.eq(expectTeamRewardPerEpoch),
      `Team rewarded per epoch is ${teamRewardPerEpoch} instead of ${expectTeamRewardPerEpoch}`
    );
    assert.strictEqual(
      teamAccount,
      expectTeamAccount,
      `Team account is ${teamAccount} instead of ${expectTeamAccount}`
    );
    assert.strictEqual(paused, expectPaused, `Paused is ${paused} instead of ${expectPaused}`);
    assert.ok(
      initialTotalUnderlyingAssetAmount.eq(expectInitialTotalUnderlyingAssetAmount),
      `Initial total underlying asset amount is ${initialTotalUnderlyingAssetAmount} instead of ${expectInitialTotalUnderlyingAssetAmount}`
    );
    assert.ok(
      initialTotalLtokenAmount.eq(expectInitialTotalLtokenAmount),
      `Initial total LToken amount is ${initialTotalLtokenAmount} instead of ${expectInitialTotalLtokenAmount}`
    );
  });

  it("should only allow governance account to change governance account", async () => {
    const nonGovernanceAccount = accounts[5];

    await expectRevert(
      treasuryPool.setGovernanceAccount(nonGovernanceAccount, { from: nonGovernanceAccount }),
      "TreasuryPool: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await treasuryPool.setGovernanceAccount(defaultGovernanceAccount, { from: defaultGovernanceAccount })
    );
  });

  it("should be changed to the specific governance account", async () => {
    const expectNewGovernanceAccount = accounts[5];

    await treasuryPool.setGovernanceAccount(expectNewGovernanceAccount, { from: defaultGovernanceAccount });
    const newGovernanceAccount = await treasuryPool.governanceAccount();

    await expectRevert(
      treasuryPool.setGovernanceAccount(ZERO_ADDRESS, { from: newGovernanceAccount }),
      "TreasuryPool: new governance account is the zero address"
    );
    assert.strictEqual(
      newGovernanceAccount,
      expectNewGovernanceAccount,
      `New governance account is ${newGovernanceAccount} instead of ${expectNewGovernanceAccount}`
    );
  });

  it("should only allow governance account to add farming pool address", async () => {
    const nonGovernanceAccount = accounts[5];
    const farmingPoolAddress = accounts[6];

    await expectRevert(
      treasuryPool.addFarmingPoolAddress(farmingPoolAddress, { from: nonGovernanceAccount }),
      "TreasuryPool: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await treasuryPool.addFarmingPoolAddress(farmingPoolAddress, { from: defaultGovernanceAccount })
    );
  });

  it("should be added the specific farming pool address", async () => {
    const farmingPoolAddress1 = accounts[5];
    const farmingPoolAddress2 = accounts[6];

    await treasuryPool.addFarmingPoolAddress(farmingPoolAddress1, { from: defaultGovernanceAccount });
    await treasuryPool.addFarmingPoolAddress(farmingPoolAddress2, { from: defaultGovernanceAccount });
    const farmingPoolAddresses = await treasuryPool.farmingPoolAddresses();

    const expectFarmingPoolAddresses = [farmingPoolAddress1, farmingPoolAddress2];

    await expectRevert(
      treasuryPool.addFarmingPoolAddress(ZERO_ADDRESS, { from: defaultGovernanceAccount }),
      "TreasuryPool: address is the zero address"
    );
    assert.deepStrictEqual(
      farmingPoolAddresses,
      expectFarmingPoolAddresses,
      `Farming pool addresses are ${farmingPoolAddresses} instead of ${expectFarmingPoolAddresses}`
    );
  });

  it("should only allow governance account to remove farming pool address", async () => {
    const nonGovernanceAccount = accounts[5];
    const farmingPoolAddress1 = accounts[6];
    const farmingPoolAddress2 = accounts[7];

    await treasuryPool.addFarmingPoolAddress(farmingPoolAddress1, { from: defaultGovernanceAccount });
    await treasuryPool.addFarmingPoolAddress(farmingPoolAddress2, { from: defaultGovernanceAccount });

    await expectRevert(
      treasuryPool.removeFarmingPoolAddress(farmingPoolAddress1, { from: nonGovernanceAccount }),
      "TreasuryPool: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await treasuryPool.removeFarmingPoolAddress(farmingPoolAddress1, { from: defaultGovernanceAccount })
    );
  });

  it("should be removed to the farming pool address", async () => {
    const farmingPoolAddress1 = accounts[5];
    const farmingPoolAddress2 = accounts[6];

    await treasuryPool.addFarmingPoolAddress(farmingPoolAddress1, { from: defaultGovernanceAccount });
    await treasuryPool.addFarmingPoolAddress(farmingPoolAddress2, { from: defaultGovernanceAccount });
    await treasuryPool.removeFarmingPoolAddress(farmingPoolAddress2, { from: defaultGovernanceAccount });
    const farmingPoolAddresses = await treasuryPool.farmingPoolAddresses();

    const expectFarmingPoolAddresses = [farmingPoolAddress1];

    assert.deepStrictEqual(
      farmingPoolAddresses,
      expectFarmingPoolAddresses,
      `Farming pool addresses are ${farmingPoolAddresses} instead of ${expectFarmingPoolAddresses}`
    );
  });

  it("should only allow governance account to pause", async () => {
    const nonGovernanceAccount = accounts[5];

    await expectRevert(treasuryPool.pause({ from: nonGovernanceAccount }), "TreasuryPool: sender not authorized");
    await assert.doesNotReject(async () => await treasuryPool.pause({ from: defaultGovernanceAccount }));
  });

  it("should be paused", async () => {
    await treasuryPool.pause({ from: defaultGovernanceAccount });
    const paused = await treasuryPool.paused();

    assert.strictEqual(paused, true, "Pool is not paused");
  });

  it("should only allow governance account to unpause", async () => {
    const nonGovernanceAccount = accounts[5];

    await treasuryPool.pause({ from: defaultGovernanceAccount });

    await expectRevert(treasuryPool.unpause({ from: nonGovernanceAccount }), "TreasuryPool: sender not authorized");
    await assert.doesNotReject(async () => await treasuryPool.unpause({ from: defaultGovernanceAccount }));
  });

  it("should be not paused", async () => {
    await treasuryPool.pause({ from: defaultGovernanceAccount });
    await treasuryPool.unpause({ from: defaultGovernanceAccount });
    const paused = await treasuryPool.paused();

    assert.strictEqual(paused, false, "Pool is still paused");
  });

  it("should not allow to add 0 liquidity", async () => {
    const liquidityProvider = accounts[5];

    await expectRevert(addLiquidity(ether("0"), liquidityProvider), "TreasuryPool: can't add 0");
  });

  it("should not allow to add liquidity while paused", async () => {
    const liquidityProvider = accounts[5];

    await treasuryPool.pause({ from: defaultGovernanceAccount });

    await expectRevert(addLiquidity(ether("1"), liquidityProvider), "TreasuryPool: deposit while paused");
  });

  it("should be able to add liquidity", async () => {
    const liquidityProvider1 = accounts[5];
    const liquidityProvider2 = accounts[6];

    await dsecDistribution.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await ltoken.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });

    // Liquidity provider 1
    const firstDepositAmountOfLP1 = ether("1.1");
    const secondDepositAmountOfLP1 = ether("1");
    const firstReceiptOfLP1 = await addLiquidity(firstDepositAmountOfLP1, liquidityProvider1);
    const secondReceiptOfLP1 = await addLiquidity(secondDepositAmountOfLP1, liquidityProvider1);

    // Liquidity provider 2
    const firstDepositAmountOfLP2 = ether("9.9");
    const secondDepositAmountOfLP2 = ether("9");
    const firstReceiptOfLP2 = await addLiquidity(firstDepositAmountOfLP2, liquidityProvider2);
    const secondReceiptOfLP2 = await addLiquidity(secondDepositAmountOfLP2, liquidityProvider2);

    const totalUnderlyingAssetAmount = await treasuryPool.totalUnderlyingAssetAmount();
    const totalLtokenAmount = await treasuryPool.totalLtokenAmount();
    const underlyingAssetBalanceOfLP1 = await underlyingAsset.balanceOf(liquidityProvider1);
    const ltokenBalanceOfLP1 = await ltoken.balanceOf(liquidityProvider1);
    const firstTimestampOfLP1 = await testUtil.getBlockTimestamp(firstReceiptOfLP1.receipt.blockHash);
    const secondTimestampOfLP1 = await testUtil.getBlockTimestamp(secondReceiptOfLP1.receipt.blockHash);
    const underlyingAssetBalanceOfLP2 = await underlyingAsset.balanceOf(liquidityProvider2);
    const ltokenBalanceOfLP2 = await ltoken.balanceOf(liquidityProvider2);
    const firstTimestampOfLP2 = await testUtil.getBlockTimestamp(firstReceiptOfLP2.receipt.blockHash);
    const secondTimestampOfLP2 = await testUtil.getBlockTimestamp(secondReceiptOfLP2.receipt.blockHash);

    const expectTotalUnderlyingAssetAmount = firstDepositAmountOfLP1
      .add(secondDepositAmountOfLP1)
      .add(firstDepositAmountOfLP2)
      .add(secondDepositAmountOfLP2);
    const expectTotalLtokenAmount = expectTotalUnderlyingAssetAmount;
    const expectUnderlyingAssetBalanceOfLP1 = ether("0");
    const expectLtokenBalanceOfLP1 = firstDepositAmountOfLP1.add(secondDepositAmountOfLP1);
    const expectUnderlyingAssetBalanceOfLP2 = ether("0");
    const expectLtokenBalanceOfLP2 = firstDepositAmountOfLP2.add(secondDepositAmountOfLP2);

    assert.ok(
      totalUnderlyingAssetAmount.eq(expectTotalUnderlyingAssetAmount),
      `Total underlying asset amount is ${totalUnderlyingAssetAmount} instead of ${expectTotalUnderlyingAssetAmount}`
    );
    assert.ok(
      totalLtokenAmount.eq(expectTotalLtokenAmount),
      `Total LToken amount is ${totalLtokenAmount} instead of ${expectTotalLtokenAmount}`
    );

    assert.ok(
      underlyingAssetBalanceOfLP1.eq(expectUnderlyingAssetBalanceOfLP1),
      `Underlying asset balance of LP1 is ${underlyingAssetBalanceOfLP1} instead of ${expectUnderlyingAssetBalanceOfLP1}`
    );
    assert.ok(
      ltokenBalanceOfLP1.eq(expectLtokenBalanceOfLP1),
      `LToken balance of LP1 is ${ltokenBalanceOfLP1} instead of ${expectLtokenBalanceOfLP1}`
    );
    await expectEvent.inTransaction(firstReceiptOfLP1.tx, dsecDistribution, "DsecAdd", {
      account: liquidityProvider1,
      amount: firstDepositAmountOfLP1,
    });
    expectEvent(firstReceiptOfLP1, "AddLiquidity", {
      account: liquidityProvider1,
      underlyingAssetAddress: underlyingAsset.address,
      ltokenAddress: ltoken.address,
      underlyingAssetToken: firstDepositAmountOfLP1,
      ltokenAmount: firstDepositAmountOfLP1,
      timestamp: firstTimestampOfLP1,
    });
    await expectEvent.inTransaction(secondReceiptOfLP1.tx, dsecDistribution, "DsecAdd", {
      account: liquidityProvider1,
      amount: secondDepositAmountOfLP1,
    });
    expectEvent(secondReceiptOfLP1, "AddLiquidity", {
      account: liquidityProvider1,
      underlyingAssetAddress: underlyingAsset.address,
      ltokenAddress: ltoken.address,
      underlyingAssetToken: secondDepositAmountOfLP1,
      ltokenAmount: secondDepositAmountOfLP1,
      timestamp: secondTimestampOfLP1,
    });

    assert.ok(
      underlyingAssetBalanceOfLP2.eq(expectUnderlyingAssetBalanceOfLP2),
      `Underlying asset balance of LP2 is ${underlyingAssetBalanceOfLP2} instead of ${expectUnderlyingAssetBalanceOfLP2}`
    );
    assert.ok(
      ltokenBalanceOfLP2.eq(expectLtokenBalanceOfLP2),
      `LToken balance of LP2 is ${ltokenBalanceOfLP2} instead of ${expectLtokenBalanceOfLP2}`
    );
    await expectEvent.inTransaction(firstReceiptOfLP2.tx, dsecDistribution, "DsecAdd", {
      account: liquidityProvider2,
      amount: firstDepositAmountOfLP2,
    });
    expectEvent(firstReceiptOfLP2, "AddLiquidity", {
      account: liquidityProvider2,
      underlyingAssetAddress: underlyingAsset.address,
      ltokenAddress: ltoken.address,
      underlyingAssetToken: firstDepositAmountOfLP2,
      ltokenAmount: firstDepositAmountOfLP2,
      timestamp: firstTimestampOfLP2,
    });
    await expectEvent.inTransaction(secondReceiptOfLP2.tx, dsecDistribution, "DsecAdd", {
      account: liquidityProvider2,
      amount: secondDepositAmountOfLP2,
    });
    expectEvent(secondReceiptOfLP2, "AddLiquidity", {
      account: liquidityProvider2,
      underlyingAssetAddress: underlyingAsset.address,
      ltokenAddress: ltoken.address,
      underlyingAssetToken: secondDepositAmountOfLP2,
      ltokenAmount: secondDepositAmountOfLP2,
      timestamp: secondTimestampOfLP2,
    });
  });

  it("should not allow to remove 0 liquidity", async () => {
    const liquidityProvider = accounts[5];

    await expectRevert(
      treasuryPool.removeLiquidity(ether("0"), { from: liquidityProvider }),
      "TreasuryPool: can't remove 0"
    );
  });

  it("should not allow to remove liquidity while paused", async () => {
    const liquidityProvider = accounts[5];

    await treasuryPool.pause({ from: defaultGovernanceAccount });

    await expectRevert(
      treasuryPool.removeLiquidity(ether("1"), { from: liquidityProvider }),
      "TreasuryPool: withdraw while paused"
    );
  });

  it("should not allow to remove liquidity when liquidity is insufficient", async () => {
    const liquidityProvider = accounts[5];

    await expectRevert(
      treasuryPool.removeLiquidity(ether("1"), { from: liquidityProvider }),
      "TreasuryPool: insufficient liquidity"
    );
  });

  it("should not allow to remove liquidity when LP has insufficient LToken", async () => {
    const liquidityProvider1 = accounts[5];
    const liquidityProvider2 = accounts[6];

    const amount = 1;
    await dsecDistribution.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await ltoken.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await addLiquidity(amount, liquidityProvider1);

    await expectRevert(
      treasuryPool.removeLiquidity(amount, { from: liquidityProvider2 }),
      "TreasuryPool: insufficient LToken"
    );
  });

  it("should be able to remove liquidity", async () => {
    const liquidityProvider1 = accounts[5];
    const liquidityProvider2 = accounts[6];

    await dsecDistribution.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await ltoken.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });

    // Add liquidity by liquidity provider 1
    const depositAmountOfLP1 = ether("1.1");
    await addLiquidity(depositAmountOfLP1, liquidityProvider1);

    // Add liquidity by liquidity provider 2
    const depositAmountOfLP2 = ether("9.9");
    await addLiquidity(depositAmountOfLP2, liquidityProvider2);

    // Fully remove liquidity by liquidity provider 1
    const withdrawAmountOfLP1 = depositAmountOfLP1;
    const receiptOfLP1 = await treasuryPool.removeLiquidity(withdrawAmountOfLP1, { from: liquidityProvider1 });

    // Partially remove liquidity by liquidity provider 2
    const firstWithdrawAmountOfLP2 = ether("0.1");
    const secondWithdrawAmountOfLP2 = ether("1");
    const firstReceiptOfLP2 = await treasuryPool.removeLiquidity(firstWithdrawAmountOfLP2, {
      from: liquidityProvider2,
    });
    const secondReceiptOfLP2 = await treasuryPool.removeLiquidity(secondWithdrawAmountOfLP2, {
      from: liquidityProvider2,
    });

    const totalUnderlyingAssetAmount = await treasuryPool.totalUnderlyingAssetAmount();
    const totalLtokenAmount = await treasuryPool.totalLtokenAmount();
    const underlyingAssetBalanceOfLP1 = await underlyingAsset.balanceOf(liquidityProvider1);
    const ltokenBalanceOfLP1 = await ltoken.balanceOf(liquidityProvider1);
    const timestampOfLP1 = await testUtil.getBlockTimestamp(receiptOfLP1.receipt.blockHash);
    const underlyingAssetBalanceOfLP2 = await underlyingAsset.balanceOf(liquidityProvider2);
    const ltokenBalanceOfLP2 = await ltoken.balanceOf(liquidityProvider2);
    const firstTimestampOfLP2 = await testUtil.getBlockTimestamp(firstReceiptOfLP2.receipt.blockHash);
    const secondTimestampOfLP2 = await testUtil.getBlockTimestamp(secondReceiptOfLP2.receipt.blockHash);

    const expectTotalUnderlyingAssetAmount = depositAmountOfLP1
      .sub(withdrawAmountOfLP1)
      .add(depositAmountOfLP2.sub(firstWithdrawAmountOfLP2).sub(secondWithdrawAmountOfLP2));
    const expectTotalLtokenAmount = expectTotalUnderlyingAssetAmount;
    const expectUnderlyingAssetBalanceOfLP1 = withdrawAmountOfLP1;
    const expectLtokenBalanceOfLP1 = depositAmountOfLP1.sub(withdrawAmountOfLP1);
    const expectUnderlyingAssetBalanceOfLP2 = firstWithdrawAmountOfLP2.add(secondWithdrawAmountOfLP2);
    const expectLtokenBalanceOfLP2 = depositAmountOfLP2.sub(firstWithdrawAmountOfLP2).sub(secondWithdrawAmountOfLP2);

    assert.ok(
      totalUnderlyingAssetAmount.eq(expectTotalUnderlyingAssetAmount),
      `Total underlying asset amount is ${totalUnderlyingAssetAmount} instead of ${expectTotalUnderlyingAssetAmount}`
    );
    assert.ok(
      totalLtokenAmount.eq(expectTotalLtokenAmount),
      `Total LToken amount is ${totalUnderlyingAssetAmount} instead of ${expectTotalUnderlyingAssetAmount}`
    );

    assert.ok(
      underlyingAssetBalanceOfLP1.eq(expectUnderlyingAssetBalanceOfLP1),
      `Underlying asset balance of LP1 is ${underlyingAssetBalanceOfLP1} instead of ${expectUnderlyingAssetBalanceOfLP1}`
    );
    assert.ok(
      ltokenBalanceOfLP1.eq(expectLtokenBalanceOfLP1),
      `LToken balance of LP1 is ${ltokenBalanceOfLP1} instead of ${expectLtokenBalanceOfLP1}`
    );
    await expectEvent.inTransaction(receiptOfLP1.tx, dsecDistribution, "DsecRemove", {
      account: liquidityProvider1,
      amount: withdrawAmountOfLP1,
    });
    expectEvent(receiptOfLP1, "RemoveLiquidity", {
      account: liquidityProvider1,
      ltokenAddress: ltoken.address,
      underlyingAssetAddress: underlyingAsset.address,
      ltokenToken: withdrawAmountOfLP1,
      underlyingAssetAmount: withdrawAmountOfLP1,
      timestamp: timestampOfLP1,
    });
    await expectRevert(
      treasuryPool.removeLiquidity(withdrawAmountOfLP1, { from: liquidityProvider1 }),
      "TreasuryPool: insufficient LToken"
    );

    assert.ok(
      underlyingAssetBalanceOfLP2.eq(expectUnderlyingAssetBalanceOfLP2),
      `Underlying asset balance of LP2 is ${underlyingAssetBalanceOfLP2} instead of ${expectUnderlyingAssetBalanceOfLP2}`
    );
    assert.ok(
      ltokenBalanceOfLP2.eq(expectLtokenBalanceOfLP2),
      `LToken balance of LP2 is ${ltokenBalanceOfLP2} instead of ${expectLtokenBalanceOfLP2}`
    );
    await expectEvent.inTransaction(firstReceiptOfLP2.tx, dsecDistribution, "DsecRemove", {
      account: liquidityProvider2,
      amount: firstWithdrawAmountOfLP2,
    });
    expectEvent(firstReceiptOfLP2, "RemoveLiquidity", {
      account: liquidityProvider2,
      ltokenAddress: ltoken.address,
      underlyingAssetAddress: underlyingAsset.address,
      ltokenToken: firstWithdrawAmountOfLP2,
      underlyingAssetAmount: firstWithdrawAmountOfLP2,
      timestamp: firstTimestampOfLP2,
    });
    await expectEvent.inTransaction(secondReceiptOfLP2.tx, dsecDistribution, "DsecRemove", {
      account: liquidityProvider2,
      amount: secondWithdrawAmountOfLP2,
    });
    expectEvent(secondReceiptOfLP2, "RemoveLiquidity", {
      account: liquidityProvider2,
      ltokenAddress: ltoken.address,
      underlyingAssetAddress: underlyingAsset.address,
      ltokenToken: secondWithdrawAmountOfLP2,
      underlyingAssetAmount: secondWithdrawAmountOfLP2,
      timestamp: secondTimestampOfLP2,
    });
  });

  it("should be able to remove liquidity with rounding tolerance difference", async () => {
    const liquidityProvider1 = accounts[5];
    const farmingPoolAddress = accounts[6];

    await dsecDistribution.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await ltoken.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });

    const depositAmount = ether("1");
    const lossAmount = wei("9999999999");
    const loanAmount = depositAmount;
    const repayAmount = loanAmount.sub(lossAmount);
    await addLiquidity(depositAmount, liquidityProvider1);
    await treasuryPool.addFarmingPoolAddress(farmingPoolAddress, { from: defaultGovernanceAccount });
    await treasuryPool.loan(loanAmount, { from: farmingPoolAddress });
    await underlyingAsset.approve(treasuryPool.address, repayAmount, { from: farmingPoolAddress });
    await treasuryPool.repay(repayAmount, 0, { from: farmingPoolAddress });
    await treasuryPool.removeFarmingPoolAddress(farmingPoolAddress, { from: defaultGovernanceAccount });

    const withdrawAmount = depositAmount;
    const receiptOfWithdraw = await treasuryPool.removeLiquidity(withdrawAmount, { from: liquidityProvider1 });

    const expectUnderlyingAssetAmount = depositAmount.sub(lossAmount);
    const timestampOfWithdraw = await testUtil.getBlockTimestamp(receiptOfWithdraw.receipt.blockHash);

    expectEvent(receiptOfWithdraw, "RemoveLiquidity", {
      account: liquidityProvider1,
      ltokenAddress: ltoken.address,
      underlyingAssetAddress: underlyingAsset.address,
      ltokenToken: depositAmount,
      underlyingAssetAmount: expectUnderlyingAssetAmount,
      timestamp: timestampOfWithdraw,
    });
  });

  it("should not allow LPs to redeem rewards when providing invalid epoch range", async () => {
    const liquidityProvider = accounts[5];

    await expectRevert(
      treasuryPool.redeemProviderReward(BN_ONE, BN_ZERO, { from: liquidityProvider }),
      "TreasuryPool: invalid epoch range"
    );
  });

  it("should not allow LPs to redeem rewards while paused", async () => {
    const liquidityProvider = accounts[5];

    await treasuryPool.pause({ from: defaultGovernanceAccount });

    await expectRevert(
      treasuryPool.redeemProviderReward(BN_ZERO, BN_ZERO, { from: liquidityProvider }),
      "TreasuryPool: redeem while paused"
    );
  });

  it("should be able to redeem rewards by LPs", async () => {
    const liquidityProvider1 = accounts[5];
    const liquidityProvider2 = accounts[6];

    const descDistGovernanceForming = await dsecDistribution.governanceForming();
    const descDistStartTimestamp = descDistGovernanceForming.startTimestamp;
    const descDistEpochDuration = descDistGovernanceForming.epochDuration;
    const descDistEndTimestamp = descDistGovernanceForming.endTimestamp;
    await lfi.addTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await dsecDistribution.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await ltoken.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });

    // Add liquidity before epoch 0 by liquidity provider 2
    const deposit0AmountOfLP2 = ether("9.9");
    await addLiquidity(deposit0AmountOfLP2, liquidityProvider2);

    await time.increaseTo(descDistStartTimestamp.add(descDistEpochDuration));

    // Add liquidity before epoch 1 by liquidity provider 2
    const deposit1AmountOfLP2 = ether("1.2");
    await addLiquidity(deposit1AmountOfLP2, liquidityProvider2);

    await time.increaseTo(descDistEndTimestamp);

    const fromEpoch = BN_ZERO;
    const toEpoch = BN_ONE;
    const firstReceiptOfLP1 = await treasuryPool.redeemProviderReward(fromEpoch, toEpoch, { from: liquidityProvider1 });
    const secondReceiptOfLP1 = await treasuryPool.redeemProviderReward(fromEpoch, toEpoch, {
      from: liquidityProvider1,
    });
    const firstReceiptOfLP2 = await treasuryPool.redeemProviderReward(fromEpoch, toEpoch, { from: liquidityProvider2 });
    const secondReceiptOfLP2 = await treasuryPool.redeemProviderReward(fromEpoch, toEpoch, {
      from: liquidityProvider2,
    });

    const totalUnderlyingAssetAmount = await treasuryPool.totalUnderlyingAssetAmount();
    const totalLtokenAmount = await treasuryPool.totalLtokenAmount();
    const underlyingAssetBalanceOfLP1 = await underlyingAsset.balanceOf(liquidityProvider1);
    const ltokenBalanceOfLP1 = await ltoken.balanceOf(liquidityProvider1);
    const lfiBalanceOfLP1 = await lfi.balanceOf(liquidityProvider1);
    const underlyingAssetBalanceOfLP2 = await underlyingAsset.balanceOf(liquidityProvider2);
    const ltokenBalanceOfLP2 = await ltoken.balanceOf(liquidityProvider2);
    const lfiBalanceOfLP2 = await lfi.balanceOf(liquidityProvider2);
    const timestampOfLP2 = await testUtil.getBlockTimestamp(firstReceiptOfLP2.receipt.blockHash);

    const expectTotalUnderlyingAssetAmount = deposit0AmountOfLP2.add(deposit1AmountOfLP2);
    const expectTotalLtokenAmount = totalLtokenAmount;
    const expectUnderlyingAssetBalanceOfLP1 = ether("0");
    const expectLtokenBalanceOfLP1 = ether("0");
    const expectLfiBalanceOfLP1 = ether("0");
    const expectUnderlyingAssetBalanceOfLP2 = ether("0");
    const expectLtokenBalanceOfLP2 = deposit0AmountOfLP2.add(deposit1AmountOfLP2);

    assert.ok(
      totalLtokenAmount.eq(expectTotalLtokenAmount),
      `Total LToken amount is ${totalUnderlyingAssetAmount} instead of ${expectTotalUnderlyingAssetAmount}`
    );
    assert.ok(
      totalUnderlyingAssetAmount.eq(expectTotalUnderlyingAssetAmount),
      `Total underlying asset amount is ${totalUnderlyingAssetAmount} instead of ${expectTotalUnderlyingAssetAmount}`
    );

    assert.ok(
      underlyingAssetBalanceOfLP1.eq(expectUnderlyingAssetBalanceOfLP1),
      `Underlying asset balance of LP1 is ${underlyingAssetBalanceOfLP1} instead of ${expectUnderlyingAssetBalanceOfLP1}`
    );
    assert.ok(
      ltokenBalanceOfLP1.eq(expectLtokenBalanceOfLP1),
      `LToken balance of LP1 is ${ltokenBalanceOfLP1} instead of ${expectLtokenBalanceOfLP1}`
    );
    assert.ok(
      lfiBalanceOfLP1.eq(expectLfiBalanceOfLP1),
      `LFI balance of LP1 is ${lfiBalanceOfLP1} instead of ${expectLfiBalanceOfLP1}`
    );
    await expectEvent.notEmitted.inTransaction(firstReceiptOfLP1.tx, dsecDistribution, "DsecRedeem");
    expectEvent.notEmitted(firstReceiptOfLP1, "RedeemProviderReward");
    await expectEvent.notEmitted.inTransaction(secondReceiptOfLP1.tx, dsecDistribution, "DsecRedeem");
    expectEvent.notEmitted(secondReceiptOfLP1, "RedeemProviderReward");

    assert.ok(
      underlyingAssetBalanceOfLP2.eq(expectUnderlyingAssetBalanceOfLP2),
      `Underlying asset balance of LP2 is ${underlyingAssetBalanceOfLP2} instead of ${expectUnderlyingAssetBalanceOfLP2}`
    );
    assert.ok(
      ltokenBalanceOfLP2.eq(expectLtokenBalanceOfLP2),
      `LToken balance of LP2 is ${ltokenBalanceOfLP2} instead of ${expectLtokenBalanceOfLP2}`
    );
    assert.ok(lfiBalanceOfLP2.gt(BN_ZERO), `LFI balance of LP2 should be greater than 0`);
    const dsecRedeemEvent0 = await expectEvent.inTransaction(firstReceiptOfLP2.tx, dsecDistribution, "DsecRedeem", {
      account: liquidityProvider2,
      epoch: BN_ZERO,
    });
    const dsecRedeemEvent1 = await expectEvent.inTransaction(firstReceiptOfLP2.tx, dsecDistribution, "DsecRedeem", {
      account: liquidityProvider2,
      epoch: BN_ONE,
    });
    expectEvent(firstReceiptOfLP2, "RedeemProviderReward", {
      account: liquidityProvider2,
      fromEpoch: fromEpoch,
      toEpoch: toEpoch,
      rewardTokenAddress: lfi.address,
      amount: new BN(dsecRedeemEvent0.args.rewardAmount).add(new BN(dsecRedeemEvent1.args.rewardAmount)),
      timestamp: timestampOfLP2,
    });
    await expectEvent.notEmitted.inTransaction(secondReceiptOfLP2.tx, dsecDistribution, "DsecRedeem");
    expectEvent.notEmitted(secondReceiptOfLP2, "RedeemProviderReward");
  });

  it("should not allow to redeem rewards by non-team account", async () => {
    const nonTeamAccount = accounts[5];

    await expectRevert(
      treasuryPool.redeemTeamReward(BN_ZERO, BN_ZERO, { from: nonTeamAccount }),
      "TreasuryPool: sender not authorized"
    );
  });

  it("should not allow team to redeem rewards when providing invalid epoch range", async () => {
    await expectRevert(
      treasuryPool.redeemTeamReward(BN_ONE, BN_ZERO, { from: defaultTeamAccount }),
      "TreasuryPool: invalid epoch range"
    );
  });

  it("should not allow team to redeem rewards while paused", async () => {
    await treasuryPool.pause({ from: defaultGovernanceAccount });

    await expectRevert(
      treasuryPool.redeemTeamReward(BN_ZERO, BN_ZERO, { from: defaultTeamAccount }),
      "TreasuryPool: redeem while paused"
    );
  });

  it("should be able to redeem rewards by the team account", async () => {
    const descDistGovernanceForming = await dsecDistribution.governanceForming();
    const teamRewardPerEpoch = await treasuryPool.teamRewardPerEpoch();
    const descDistEndTimestamp = descDistGovernanceForming.endTimestamp;
    await lfi.addTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await dsecDistribution.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });

    await time.increaseTo(descDistEndTimestamp);

    const beforeLfiBalance = await lfi.balanceOf(defaultTeamAccount);
    const fromEpoch = BN_ZERO;
    const toEpoch = BN_ONE;
    const expectLfiBalanceAfterRedeemed = await testUtil.estimateLfiBalanceAfterTransfer(
      lfi,
      lfi.address,
      defaultTeamAccount,
      teamRewardPerEpoch.mul(toEpoch.sub(fromEpoch).add(BN_ONE)),
      "recipient"
    );
    const firstReceipt = await treasuryPool.redeemTeamReward(fromEpoch, toEpoch, { from: defaultTeamAccount });
    const secondReceipt = await treasuryPool.redeemTeamReward(fromEpoch, toEpoch, { from: defaultTeamAccount });

    const afterLfiBalance = await lfi.balanceOf(defaultTeamAccount);
    const totalUnderlyingAssetAmount = await treasuryPool.totalUnderlyingAssetAmount();
    const totalLtokenAmount = await treasuryPool.totalLtokenAmount();
    const underlyingAssetBalance = await underlyingAsset.balanceOf(defaultTeamAccount);
    const ltokenBalance = await ltoken.balanceOf(defaultTeamAccount);
    const receivedLfiRedemptionAmount = afterLfiBalance.sub(beforeLfiBalance);
    const timestamp = await testUtil.getBlockTimestamp(firstReceipt.receipt.blockHash);

    const expectTotalUnderlyingAssetAmount = ether("0");
    const expectTotalLtokenAmount = expectTotalUnderlyingAssetAmount;
    const expectUnderlyingAssetBalance = ether("0");
    const expectLtokenBalance = ether("0");
    const expectReceivedLfiRedemptionAmount = expectLfiBalanceAfterRedeemed.sub(beforeLfiBalance);
    const expectRedeemedLfiAmount = teamRewardPerEpoch.mul(toEpoch.sub(fromEpoch).add(BN_ONE));

    assert.ok(
      totalUnderlyingAssetAmount.eq(expectTotalUnderlyingAssetAmount),
      `Total underlying asset amount is ${totalUnderlyingAssetAmount} instead of ${expectTotalUnderlyingAssetAmount}`
    );
    assert.ok(
      totalLtokenAmount.eq(expectTotalLtokenAmount),
      `Total LToken amount is ${totalUnderlyingAssetAmount} instead of ${expectTotalUnderlyingAssetAmount}`
    );
    assert.ok(
      underlyingAssetBalance.eq(expectUnderlyingAssetBalance),
      `Underlying asset balance is ${underlyingAssetBalance} instead of ${expectUnderlyingAssetBalance}`
    );
    assert.ok(
      ltokenBalance.eq(expectLtokenBalance),
      `LToken balance is ${ltokenBalance} instead of ${expectLtokenBalance}`
    );
    assert.ok(
      testUtil.bnDiffInRange(receivedLfiRedemptionAmount, expectReceivedLfiRedemptionAmount, BN_ONE),
      `Received LFI redemption amount ${receivedLfiRedemptionAmount} is not close to ${expectReceivedLfiRedemptionAmount}`
    );
    await expectEvent.inTransaction(firstReceipt.tx, dsecDistribution, "TeamRewardRedeem", {
      sender: treasuryPool.address,
      epoch: BN_ZERO,
    });
    await expectEvent.inTransaction(firstReceipt.tx, dsecDistribution, "TeamRewardRedeem", {
      sender: treasuryPool.address,
      epoch: BN_ONE,
    });
    expectEvent(firstReceipt, "RedeemTeamReward", {
      account: defaultTeamAccount,
      fromEpoch: fromEpoch,
      toEpoch: toEpoch,
      rewardTokenAddress: lfi.address,
      amount: expectRedeemedLfiAmount,
      timestamp: timestamp,
    });
    await expectEvent.notEmitted.inTransaction(secondReceipt.tx, dsecDistribution, "TeamRewardRedeem");
    expectEvent.notEmitted(secondReceipt, "RedeemProviderReward");
  });

  it("should not allow to migrate to new pool contracts while not paused", async () => {
    const liquidityProvider = accounts[5];

    await lfi.addTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await dsecDistribution.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await ltoken.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });

    const depositAmount = ether("1.1");
    await addLiquidity(depositAmount, liquidityProvider);

    await expectRevert(NewTreasuryPoolMock.new(treasuryPool.address), "migrate while not paused");
  });

  it("should be able to migrate to new pool contracts", async () => {
    const liquidityProvider = accounts[5];

    await lfi.addTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await dsecDistribution.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });
    await ltoken.setTreasuryPoolAddress(treasuryPool.address, { from: defaultGovernanceAccount });

    const depositAmount = ether("1.1");
    await addLiquidity(depositAmount, liquidityProvider);
    await treasuryPool.pause({ from: defaultGovernanceAccount });

    const newTreasuryPool = await NewTreasuryPoolMock.new(treasuryPool.address);

    const lfiAddress = await newTreasuryPool.lfiAddress();
    const underlyingAssetAddress = await newTreasuryPool.underlyingAssetAddress();
    const ltokenAddress = await newTreasuryPool.ltokenAddress();
    const teamAccount = await newTreasuryPool.teamAccount();
    const dsecDistributionAddress = await newTreasuryPool.dsecDistributionAddress();
    const initialTotalUnderlyingAssetAmount = await newTreasuryPool.totalUnderlyingAssetAmount();
    const initialTotalLtokenAmount = await newTreasuryPool.totalLtokenAmount();

    const expectLfiAddress = lfi.address;
    const expectUnderlyingAssetAddress = underlyingAsset.address;
    const expectLtokenAddress = ltoken.address;
    const expectTeamAccount = teamAccount;
    const expectDsecDistributionAddress = dsecDistribution.address;
    const expectInitialTotalUnderlyingAssetAmount = depositAmount;
    const expectInitialTotalLtokenAmount = depositAmount;

    assert.strictEqual(lfiAddress, expectLfiAddress, `LFI address is ${lfiAddress} instead of ${expectLfiAddress}`);
    assert.strictEqual(
      underlyingAssetAddress,
      expectUnderlyingAssetAddress,
      `Underlying asset address is ${underlyingAssetAddress} instead of ${expectUnderlyingAssetAddress}`
    );
    assert.strictEqual(
      ltokenAddress,
      expectLtokenAddress,
      `LToken address is ${ltokenAddress} instead of ${expectLtokenAddress}`
    );
    assert.strictEqual(
      teamAccount,
      expectTeamAccount,
      `Team account is ${teamAccount} instead of ${expectTeamAccount}`
    );
    assert.strictEqual(
      dsecDistributionAddress,
      expectDsecDistributionAddress,
      `DSec distributionAddress is ${dsecDistributionAddress} instead of ${expectDsecDistributionAddress}`
    );
    assert.ok(
      initialTotalUnderlyingAssetAmount.eq(expectInitialTotalUnderlyingAssetAmount),
      `Initial total underlying asset amount is ${initialTotalUnderlyingAssetAmount} instead of ${expectInitialTotalUnderlyingAssetAmount}`
    );
    assert.ok(
      initialTotalLtokenAmount.eq(expectInitialTotalLtokenAmount),
      `Initial total LToken amount is ${initialTotalLtokenAmount} instead of ${expectInitialTotalLtokenAmount}`
    );
    assert.ok(
      initialTotalUnderlyingAssetAmount.eq(initialTotalLtokenAmount),
      `Initial total underlying asset amount ${initialTotalUnderlyingAssetAmount} doesn't equal initial total LToken amount ${initialTotalLtokenAmount}`
    );
  });

  async function addLiquidity(amount, liquidityProvider) {
    await underlyingAsset.mint(liquidityProvider, amount, { from: defaultGovernanceAccount });
    await underlyingAsset.approve(treasuryPool.address, amount, { from: liquidityProvider });
    return await treasuryPool.addLiquidity(amount, { from: liquidityProvider });
  }
});
