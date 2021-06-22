const { expectEvent, expectRevert, time } = require("@openzeppelin/test-helpers");
const timeMachine = require("ganache-time-traveler");
const { BN, ZERO_ADDRESS, ...testUtil } = require("./testUtil");

const NUMBER_OF_DEPOSITS_IN_EPOCH = 5;
const DISTRIBUTION_AMOUNT_PER_EPOCH = new BN(web3.utils.toWei("3250", "ether"));

const EPOCH_START_LEAD_TIME_SECS = 120;
const EPOCH_END_LEAD_TIME_SECS = 10;
const INTERVAL_END_LEAD_TIME_SECS = 10;

const ExpectGovernanceForming = {
  startTimestamp: new BN("1641686400"),
  epochDuration: new BN("1209600"),
  intervalBetweenEpochs: new BN("86400"),
  totalNumberOfEpochs: new BN("10"),
  endTimestamp: new BN("1654560000"),
};

describe("DsecDistribution", () => {
  let accounts;
  let snapshotId;
  let dsecDistribution;

  beforeEach(async () => {
    accounts = await web3.eth.getAccounts();
    let snapshot = await timeMachine.takeSnapshot();
    snapshotId = snapshot["result"];
    dsecDistribution = await testUtil.newDsecDistribution();
  });

  afterEach(async () => {
    await timeMachine.revertToSnapshot(snapshotId);
  });

  it("should be initialized correctly", async () => {
    const governanceForming = await dsecDistribution.governanceForming();
    const governanceAccount = await dsecDistribution.governanceAccount();
    const treasuryPoolAddress = await dsecDistribution.treasuryPoolAddress();
    const totalNumberOfEpochs = await dsecDistribution.totalNumberOfEpochs();

    const expectGovernanceAccount = accounts[0];
    const expectTreasuryPoolAddress = accounts[0];

    assert.ok(
      governanceForming.startTimestamp.eq(ExpectGovernanceForming.startTimestamp),
      `Governance forming start timestamp is ${governanceForming.startTimestamp} instead of ${ExpectGovernanceForming.startTimestamp}`
    );
    assert.ok(
      governanceForming.epochDuration.eq(ExpectGovernanceForming.epochDuration),
      `Governance forming epoch duration is ${governanceForming.epochDuration} instead of ${ExpectGovernanceForming.epochDuration}`
    );
    assert.ok(
      governanceForming.intervalBetweenEpochs.eq(ExpectGovernanceForming.intervalBetweenEpochs),
      `Governance forming interval between epochs is ${governanceForming.intervalBetweenEpochs} instead of ${ExpectGovernanceForming.intervalBetweenEpochs}`
    );
    assert.ok(
      governanceForming.endTimestamp.eq(ExpectGovernanceForming.endTimestamp),
      `Governance forming end timestamp is ${governanceForming.endTimestamp} instead of ${ExpectGovernanceForming.endTimestamp}`
    );
    assert.strictEqual(
      governanceAccount,
      expectGovernanceAccount,
      `Governance account is ${governanceAccount} instead of dsecDistribution creator ${expectGovernanceAccount}`
    );
    assert.strictEqual(
      treasuryPoolAddress,
      expectTreasuryPoolAddress,
      `Treasury pool address is ${treasuryPoolAddress} instead of ${expectTreasuryPoolAddress}`
    );
    assert.ok(
      totalNumberOfEpochs.eq(ExpectGovernanceForming.totalNumberOfEpochs),
      `Governance forming epoch duration is ${totalNumberOfEpochs} instead of ${ExpectGovernanceForming.totalNumberOfEpochs}`
    );
  });

  it("should only allow governance account to change governance account", async () => {
    const defaultGovernanceAccount = accounts[0];
    const nonGovernanceAccount = accounts[1];
    const expectNewGovernanceAccount = accounts[2];

    await expectRevert(
      dsecDistribution.setGovernanceAccount(ZERO_ADDRESS, { from: defaultGovernanceAccount }),
      "new governance account is the zero address"
    );

    await expectRevert(
      dsecDistribution.setGovernanceAccount(expectNewGovernanceAccount, { from: nonGovernanceAccount }),
      "sender not authorized"
    );

    await dsecDistribution.setGovernanceAccount(expectNewGovernanceAccount, { from: defaultGovernanceAccount });
    const newGovernanceAccount = await dsecDistribution.governanceAccount();
    assert.strictEqual(
      newGovernanceAccount,
      expectNewGovernanceAccount,
      `New governance account is ${newGovernanceAccount} instead of ${expectNewGovernanceAccount}`
    );

    await expectRevert(
      dsecDistribution.setGovernanceAccount(defaultGovernanceAccount, { from: defaultGovernanceAccount }),
      "sender not authorized"
    );

    await dsecDistribution.setGovernanceAccount(defaultGovernanceAccount, { from: expectNewGovernanceAccount });
    const governanceAccount = await dsecDistribution.governanceAccount();
    assert.strictEqual(
      governanceAccount,
      defaultGovernanceAccount,
      `Governance account is ${governanceAccount} instead of ${defaultGovernanceAccount}`
    );
  });

  it("should only allow governance account to change treasury pool address", async () => {
    const governanceAccount = accounts[0];
    const nonGovernanceAccount = accounts[1];
    const defaultTreasuryPoolAddress = accounts[0];
    const expectNewTreasuryPoolAddress = accounts[2];

    await expectRevert(
      dsecDistribution.setTreasuryPoolAddress(ZERO_ADDRESS, { from: governanceAccount }),
      "new treasury pool address is the zero address"
    );

    await expectRevert(
      dsecDistribution.setTreasuryPoolAddress(expectNewTreasuryPoolAddress, { from: nonGovernanceAccount }),
      "sender not authorized"
    );

    await dsecDistribution.setTreasuryPoolAddress(expectNewTreasuryPoolAddress, { from: governanceAccount });
    const newTreasuryPoolAddress = await dsecDistribution.treasuryPoolAddress();
    assert.strictEqual(
      newTreasuryPoolAddress,
      expectNewTreasuryPoolAddress,
      `New treasury pool address is ${newTreasuryPoolAddress} instead of ${expectNewTreasuryPoolAddress}`
    );

    await expectRevert(
      dsecDistribution.setTreasuryPoolAddress(defaultTreasuryPoolAddress, { from: nonGovernanceAccount }),
      "sender not authorized"
    );

    await dsecDistribution.setTreasuryPoolAddress(defaultTreasuryPoolAddress, { from: governanceAccount });
    const treasuryPoolAddress = await dsecDistribution.treasuryPoolAddress();
    assert.strictEqual(
      treasuryPoolAddress,
      defaultTreasuryPoolAddress,
      `Treasury pool address is ${treasuryPoolAddress} instead of ${defaultTreasuryPoolAddress}`
    );
  });

  it("should only allow treasury pool to update dsec", async () => {
    const treasuryPoolAddress = accounts[0];
    const nonTreasuryPoolAddress = accounts[1];

    await expectRevert(
      dsecDistribution.addDsec(nonTreasuryPoolAddress, new BN("0"), { from: nonTreasuryPoolAddress }),
      "sender not authorized"
    );
    await expectRevert(
      dsecDistribution.removeDsec(nonTreasuryPoolAddress, new BN("0"), { from: nonTreasuryPoolAddress }),
      "sender not authorized"
    );
    await expectRevert(
      dsecDistribution.redeemDsec(nonTreasuryPoolAddress, new BN("0"), DISTRIBUTION_AMOUNT_PER_EPOCH, {
        from: nonTreasuryPoolAddress,
      }),
      "sender not authorized"
    );
    await expectRevert(
      dsecDistribution.redeemTeamReward(new BN("0"), { from: nonTreasuryPoolAddress }),
      "sender not authorized"
    );

    await expectRevert(
      dsecDistribution.addDsec(nonTreasuryPoolAddress, new BN("0"), { from: treasuryPoolAddress }),
      "add zero amount"
    );
    await expectRevert(
      dsecDistribution.removeDsec(nonTreasuryPoolAddress, new BN("0"), { from: treasuryPoolAddress }),
      "remove zero amount"
    );
    await expectRevert(
      dsecDistribution.redeemTeamReward(new BN("0"), { from: treasuryPoolAddress }),
      "only for completed epochs"
    );

    const redeemDsec = await dsecDistribution.redeemDsec(
      nonTreasuryPoolAddress,
      new BN(ExpectGovernanceForming.totalNumberOfEpochs),
      DISTRIBUTION_AMOUNT_PER_EPOCH,
      { from: treasuryPoolAddress }
    );
    expectEvent.notEmitted(redeemDsec, "DsecRedeem");
  });

  it("should revert when add/remove/redeem zero dsec or to/from zero address", async () => {
    const sampleAccount = accounts[2];

    await expectRevert(dsecDistribution.addDsec(ZERO_ADDRESS, new BN("1")), "add to zero address");
    await expectRevert(dsecDistribution.removeDsec(ZERO_ADDRESS, new BN("1")), "remove from zero address");
    await expectRevert(
      dsecDistribution.redeemDsec(ZERO_ADDRESS, new BN("0"), DISTRIBUTION_AMOUNT_PER_EPOCH),
      "redeem for zero address"
    );

    await expectRevert(dsecDistribution.addDsec(sampleAccount, new BN("0")), "add zero amount");
    await expectRevert(dsecDistribution.removeDsec(sampleAccount, new BN("0")), "remove zero amount");
    await expectRevert(
      dsecDistribution.calculateRewardFor(sampleAccount, new BN("0"), new BN("0")),
      "zero distribution amount"
    );
    await expectRevert(
      dsecDistribution.estimateRewardForCurrentEpoch(sampleAccount, new BN("0")),
      "zero distribution amount"
    );
  });

  it("should return zero reward for zero address", async () => {
    const calculateRewardFor = await dsecDistribution.calculateRewardFor(
      ZERO_ADDRESS,
      new BN("0"),
      DISTRIBUTION_AMOUNT_PER_EPOCH
    );
    const expectCalculateRewardFor = new BN("0");

    assert.ok(
      calculateRewardFor.eq(expectCalculateRewardFor),
      `calculateRewardFor is ${calculateRewardFor} instead of ${expectCalculateRewardFor}`
    );

    const estimateRewardForCurrentEpoch = await dsecDistribution.estimateRewardForCurrentEpoch(
      ZERO_ADDRESS,
      DISTRIBUTION_AMOUNT_PER_EPOCH
    );
    const expectEstimateRewardForCurrentEpoch = new BN("0");

    assert.ok(
      estimateRewardForCurrentEpoch.eq(expectEstimateRewardForCurrentEpoch),
      `estimateRewardForCurrentEpoch is ${estimateRewardForCurrentEpoch} instead of ${expectEstimateRewardForCurrentEpoch}`
    );
  });

  it("should return zero reward when no deposits by anyone in epoch", async () => {
    const sampleAccount = accounts[2];
    const sampleEpoch = 9;

    await time.increaseTo(expectEpochStartTimestamps[sampleEpoch]);

    const expectCalculateRewardFor = new BN("0");
    const expectEstimateRewardForCurrentEpoch = new BN("0");

    for (let epoch = 0; epoch < sampleEpoch; epoch++) {
      const calculateRewardFor = await dsecDistribution.calculateRewardFor(
        sampleAccount,
        new BN("0"),
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );

      assert.ok(
        calculateRewardFor.eq(expectCalculateRewardFor),
        `Epoch ${epoch}: calculateRewardFor is ${calculateRewardFor} instead of ${expectCalculateRewardFor}`
      );

      const estimateRewardForCurrentEpoch = await dsecDistribution.estimateRewardForCurrentEpoch(
        sampleAccount,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );

      assert.ok(
        estimateRewardForCurrentEpoch.eq(expectEstimateRewardForCurrentEpoch),
        `Epoch ${epoch}: estimateRewardForCurrentEpoch is ${estimateRewardForCurrentEpoch} instead of ${expectEstimateRewardForCurrentEpoch}`
      );
    }
  });

  it("should not have redeemed", async () => {
    const sampleAccount = accounts[2];
    const expectHasRedeemedDsec = false;
    const expectHasRedeemedTeamReward = false;

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const hasRedeemedDsec = await dsecDistribution.hasRedeemedDsec(sampleAccount, epoch);
      assert.strictEqual(
        hasRedeemedDsec,
        expectHasRedeemedDsec,
        `Epoch ${epoch}: hasRedeemedDsec for ${sampleAccount} is ${hasRedeemedDsec} instead of ${expectHasRedeemedDsec}`
      );

      const hasRedeemedTeamReward = await dsecDistribution.hasRedeemedTeamReward(epoch);
      assert.strictEqual(
        hasRedeemedTeamReward,
        expectHasRedeemedTeamReward,
        `Epoch ${epoch}: hasRedeemedTeamReward is ${hasRedeemedTeamReward} instead of ${expectHasRedeemedTeamReward}`
      );
    }
  });

  it("should revert when checking whether redeemed for epochs after governance forming has ended", async () => {
    const sampleAccount = accounts[2];
    const expectHasRedeemed = false;

    for (let epoch = ExpectGovernanceForming.totalNumberOfEpochs; epoch < 100; epoch++) {
      await expectRevert(dsecDistribution.hasRedeemedDsec(sampleAccount, epoch), "governance forming ended");
      await expectRevert(dsecDistribution.hasRedeemedTeamReward(epoch), "governance forming ended");
    }
  });

  it("should not emit event when redeeming for epochs after governance forming has ended", async () => {
    const sampleAccount = accounts[2];

    for (let epoch = ExpectGovernanceForming.totalNumberOfEpochs; epoch < 100; epoch++) {
      const redeemDsec = await dsecDistribution.redeemDsec(sampleAccount, epoch, DISTRIBUTION_AMOUNT_PER_EPOCH);
      expectEvent.notEmitted(redeemDsec, "DsecRedeem");

      await expectRevert(dsecDistribution.redeemTeamReward(epoch), "governance forming ended");
    }
  });

  const expectEpochStartTimestamps = [
    new BN("1641686400"),
    new BN("1642982400"),
    new BN("1644278400"),
    new BN("1645574400"),
    new BN("1646870400"),
    new BN("1648166400"),
    new BN("1649462400"),
    new BN("1650758400"),
    new BN("1652054400"),
    new BN("1653350400"),
  ];

  const expectEpochEndTimestamps = [
    new BN("1642896000"),
    new BN("1644192000"),
    new BN("1645488000"),
    new BN("1646784000"),
    new BN("1648080000"),
    new BN("1649376000"),
    new BN("1650672000"),
    new BN("1651968000"),
    new BN("1653264000"),
    new BN("1654560000"),
  ];

  it("should return correct start and end timestamps for epoch", async () => {
    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const epochStartTimestamp = await dsecDistribution.getStartTimestampForEpoch(epoch);
      assert.ok(
        epochStartTimestamp.eq(expectEpochStartTimestamps[epoch]),
        `Epoch ${epoch}: Start timestamp is ${epochStartTimestamp} instead of ${expectEpochStartTimestamps[epoch]}`
      );

      const epochEndTimestamp = await dsecDistribution.getEndTimestampForEpoch(epoch);
      assert.ok(
        epochEndTimestamp.eq(expectEpochEndTimestamps[epoch]),
        `Epoch ${epoch}: End timestamp is ${epochEndTimestamp} instead of ${expectEpochEndTimestamps[epoch]}`
      );

      const epochStartEndTimestamps = await dsecDistribution.getStartEndTimestampsForEpoch(epoch);
      assert.ok(
        epochStartEndTimestamps[0].eq(expectEpochStartTimestamps[epoch]),
        `Epoch ${epoch}: Start timestamp for start/end timestamps is ${epochStartEndTimestamps[1]} instead of ${expectEpochStartTimestamps[epoch]}`
      );
      assert.ok(
        epochStartEndTimestamps[1].eq(expectEpochEndTimestamps[epoch]),
        `Epoch ${epoch}: End timestamp for start/end timestamps is ${epochStartEndTimestamps[1]} instead of ${expectEpochEndTimestamps[epoch]}`
      );
    }
  });

  it("should return 0 start/end timestamp for epochs beyond total number of epochs", async () => {
    const expectEpochStartTimestamp = new BN("0");
    const expectEpochEndTimestamp = new BN("0");

    for (let epoch = ExpectGovernanceForming.totalNumberOfEpochs; epoch < 100; epoch++) {
      const epochStartTimestamp = await dsecDistribution.getStartTimestampForEpoch(epoch);
      assert.ok(
        epochStartTimestamp.eq(expectEpochStartTimestamp),
        `Epoch ${epoch}: Start timestamp is ${epochStartTimestamp} instead of ${expectEpochStartTimestamp}`
      );

      const epochEndTimestamp = await dsecDistribution.getEndTimestampForEpoch(epoch);
      assert.ok(
        epochEndTimestamp.eq(expectEpochEndTimestamp),
        `Epoch ${epoch}: End timestamp is ${epochEndTimestamp} instead of ${expectEpochEndTimestamp}`
      );

      const epochStartEndTimestamps = await dsecDistribution.getStartEndTimestampsForEpoch(epoch);
      assert.ok(
        epochStartEndTimestamps[0].eq(expectEpochStartTimestamp),
        `Epoch ${epoch}: Start timestamp for start/end timestamps is ${epochStartEndTimestamps[0]} instead of ${expectEpochStartTimestamp}`
      );
      assert.ok(
        epochStartEndTimestamps[1].eq(expectEpochEndTimestamp),
        `Epoch ${epoch}: End timestamp for start/end timestamps is ${epochStartEndTimestamps[1]} instead of ${expectEpochStartTimestamp}`
      );
    }
  });

  it("should return correct reward amount for user full withdrawal in same epoch before epoch 0", async () => {
    const sampleAccount = accounts[2];
    const sampleDepositAmount = new BN(web3.utils.toWei("1614426628.19883636318961100", "ether"));
    const expectDsecBalanceBeforeAdd = new BN("0");

    await time.increaseTo(expectEpochStartTimestamps[0].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceBeforeAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);

      assert.ok(
        dsecBalanceBeforeAdd.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd} instead of ${expectDsecBalanceBeforeAdd}`
      );
    }

    let addDsec = await dsecDistribution.addDsec(sampleAccount, sampleDepositAmount);
    let addDsecBlockTimestamp = await testUtil.getBlockTimestamp(addDsec.receipt.blockHash);

    const expectDsecAddEpoch = new BN("0");
    const expectAddDsec = new BN(web3.utils.toWei("1952810449469312.4649141534656", "ether"));

    expectEvent(addDsec, "DsecAdd", {
      account: sampleAccount,
      epoch: expectDsecAddEpoch,
      amount: sampleDepositAmount,
      timestamp: addDsecBlockTimestamp,
      dsec: expectAddDsec,
    });

    const expectDsecBalanceAfterAdd = expectAddDsec;

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance = epoch == 0 ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp} is ${dsecBalanceAfterAdd} instead of ${expectDsecBalance}`
      );
    }

    let removeDsec = await dsecDistribution.removeDsec(sampleAccount, sampleDepositAmount);
    let removeDsecBlockTimestamp = await testUtil.getBlockTimestamp(removeDsec.receipt.blockHash);

    const expectDsecRemoveEpoch = new BN("0");
    const expectRemoveDsec = expectAddDsec;

    expectEvent(removeDsec, "DsecRemove", {
      account: sampleAccount,
      epoch: expectDsecRemoveEpoch,
      amount: sampleDepositAmount,
      timestamp: removeDsecBlockTimestamp,
      dsec: expectRemoveDsec,
    });

    const expectDsecBalanceAfterRemove = new BN("0");

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterRemove = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);

      assert.ok(
        dsecBalanceAfterRemove.eq(expectDsecBalanceAfterRemove),
        `Epoch ${epoch}: dsecBalance after remove of ${sampleDepositAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove} instead of ${expectDsecBalanceAfterRemove}`
      );
    }

    for (let i = 0; i < ExpectGovernanceForming.totalNumberOfEpochs; i++) {
      await time.increaseTo(expectEpochEndTimestamps[i]);

      for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
        const dsecBalanceAfterRemove = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);

        assert.ok(
          dsecBalanceAfterRemove.eq(expectDsecBalanceAfterRemove),
          `Index ${i} Epoch ${epoch}: dsecBalance after remove of ${sampleDepositAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove} instead of ${expectDsecBalanceAfterRemove}`
        );
      }
    }
  });

  it("should return correct reward amount for user full withdrawal in interval with deposit before epoch 0", async () => {
    const sampleAccount = accounts[2];
    const sampleDepositAmount = new BN(web3.utils.toWei("213564.990773257706911000", "ether"));
    const expectDsecBalanceBeforeAdd = new BN("0");

    await time.increaseTo(expectEpochStartTimestamps[0].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceBeforeAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);

      assert.ok(
        dsecBalanceBeforeAdd.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd} instead of ${expectDsecBalanceBeforeAdd}`
      );
    }

    let addDsec = await dsecDistribution.addDsec(sampleAccount, sampleDepositAmount);
    let addDsecBlockTimestamp = await testUtil.getBlockTimestamp(addDsec.receipt.blockHash);

    const expectDsecAddEpoch = new BN("0");
    const expectAddDsec = new BN(web3.utils.toWei("258328212839.3325222795456", "ether"));

    expectEvent(addDsec, "DsecAdd", {
      account: sampleAccount,
      epoch: expectDsecAddEpoch,
      amount: sampleDepositAmount,
      timestamp: addDsecBlockTimestamp,
      dsec: expectAddDsec,
    });

    const expectDsecBalanceAfterAdd = expectAddDsec;

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance = epoch == 0 ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp} is ${dsecBalanceAfterAdd} instead of ${expectDsecBalance}`
      );
    }

    const epochWithdraw = 5;
    await time.increaseTo(expectEpochStartTimestamps[epochWithdraw].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance = epoch <= epochWithdraw ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp} is ${dsecBalanceAfterAdd} instead of ${expectDsecBalance}`
      );
    }

    let removeDsec = await dsecDistribution.removeDsec(sampleAccount, sampleDepositAmount);
    let removeDsecBlockTimestamp = await testUtil.getBlockTimestamp(removeDsec.receipt.blockHash);

    const expectDsecRemoveEpoch = new BN(epochWithdraw);
    const expectRemoveDsec = expectAddDsec;

    expectEvent(removeDsec, "DsecRemove", {
      account: sampleAccount,
      epoch: expectDsecRemoveEpoch,
      amount: sampleDepositAmount,
      timestamp: removeDsecBlockTimestamp,
      dsec: expectRemoveDsec,
    });

    const expectDsecBalanceAfterRemove = new BN("0");

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterRemove = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance =
        epoch < epochWithdraw
          ? expectDsecBalanceAfterAdd
          : epoch == epochWithdraw
          ? expectDsecBalanceAfterRemove
          : new BN("0");

      assert.ok(
        dsecBalanceAfterRemove.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after remove of ${sampleDepositAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove} instead of ${expectDsecBalanceAfterRemove}`
      );
    }

    for (let i = epochWithdraw; i < ExpectGovernanceForming.totalNumberOfEpochs; i++) {
      await time.increaseTo(expectEpochEndTimestamps[i]);

      for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
        const dsecBalanceAfterRemove = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
        const expectDsecBalance =
          epoch < epochWithdraw
            ? expectDsecBalanceAfterAdd
            : epoch <= i + 1
            ? expectDsecBalanceAfterRemove
            : new BN("0");

        assert.ok(
          dsecBalanceAfterRemove.eq(expectDsecBalance),
          `Index ${i} Epoch ${epoch}: dsecBalance after remove of ${sampleDepositAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove} instead of ${expectDsecBalance}`
        );
      }
    }
  });

  it("should return correct reward amount for user partial withdrawal in same epoch before epoch 0", async () => {
    const sampleAccount = accounts[2];
    const sampleDepositAmount = new BN(web3.utils.toWei("2210621997.603637733860128000", "ether"));
    const sampleWithdrawAmount = new BN(web3.utils.toWei("649852320.396610630398983000", "ether"));
    const expectDsecBalanceBeforeAdd = new BN("0");

    await time.increaseTo(expectEpochStartTimestamps[0].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceBeforeAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);

      assert.ok(
        dsecBalanceBeforeAdd.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd} instead of ${expectDsecBalanceBeforeAdd}`
      );
    }

    let addDsec = await dsecDistribution.addDsec(sampleAccount, sampleDepositAmount);
    let addDsecBlockTimestamp = await testUtil.getBlockTimestamp(addDsec.receipt.blockHash);

    const expectDsecAddEpoch = new BN("0");
    const expectAddDsec = new BN(web3.utils.toWei("2673968368301360.2028772108288", "ether"));

    expectEvent(addDsec, "DsecAdd", {
      account: sampleAccount,
      epoch: expectDsecAddEpoch,
      amount: sampleDepositAmount,
      timestamp: addDsecBlockTimestamp,
      dsec: expectAddDsec,
    });

    const expectDsecBalanceAfterAdd = expectAddDsec;

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance = epoch == 0 ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp} is ${dsecBalanceAfterAdd} instead of ${expectDsecBalance}`
      );
    }

    let removeDsec = await dsecDistribution.removeDsec(sampleAccount, sampleWithdrawAmount);
    let removeDsecBlockTimestamp = await testUtil.getBlockTimestamp(removeDsec.receipt.blockHash);

    const expectDsecRemoveEpoch = new BN("0");
    const expectRemoveDsec = new BN(web3.utils.toWei("786061366751740.2185306098368", "ether"));

    expectEvent(removeDsec, "DsecRemove", {
      account: sampleAccount,
      epoch: expectDsecRemoveEpoch,
      amount: sampleWithdrawAmount,
      timestamp: removeDsecBlockTimestamp,
      dsec: expectRemoveDsec,
    });

    const expectDsecBalanceAfterRemove = new BN(web3.utils.toWei("1887907001549619.984346600992", "ether"));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterRemove = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance = epoch == 0 ? expectDsecBalanceAfterRemove : new BN("0");

      assert.ok(
        dsecBalanceAfterRemove.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove} instead of ${expectDsecBalance}`
      );
    }

    for (let i = 0; i < ExpectGovernanceForming.totalNumberOfEpochs; i++) {
      await time.increaseTo(expectEpochEndTimestamps[i]);

      for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
        const dsecBalanceAfterRemove = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
        const expectDsecBalance = epoch <= i + 1 ? expectDsecBalanceAfterRemove : new BN("0");

        assert.ok(
          dsecBalanceAfterRemove.eq(expectDsecBalance),
          `Index ${i} Epoch ${epoch}: dsecBalance after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove} instead of ${expectDsecBalance}`
        );
      }
    }
  });

  it("should return correct reward amount for user partial withdrawal in interval with deposit before epoch 0", async () => {
    const sampleAccount = accounts[2];
    const sampleDepositAmount = new BN(web3.utils.toWei("37.000500944505351339", "ether"));
    const sampleWithdrawAmount = new BN(web3.utils.toWei("3.001078524510531370", "ether"));
    const expectDsecBalanceBeforeAdd = new BN("0");

    await time.increaseTo(expectEpochStartTimestamps[0].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceBeforeAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);

      assert.ok(
        dsecBalanceBeforeAdd.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd} instead of ${expectDsecBalanceBeforeAdd}`
      );
    }

    let addDsec = await dsecDistribution.addDsec(sampleAccount, sampleDepositAmount);
    let addDsecBlockTimestamp = await testUtil.getBlockTimestamp(addDsec.receipt.blockHash);

    const expectDsecAddEpoch = new BN("0");
    const expectAddDsec = new BN(web3.utils.toWei("44755805.942473672979654400", "ether"));

    expectEvent(addDsec, "DsecAdd", {
      account: sampleAccount,
      epoch: expectDsecAddEpoch,
      amount: sampleDepositAmount,
      timestamp: addDsecBlockTimestamp,
      dsec: expectAddDsec,
    });

    const expectDsecBalanceAfterAdd = expectAddDsec;

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance = epoch == 0 ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp} is ${dsecBalanceAfterAdd} instead of ${expectDsecBalance}`
      );
    }

    const epochWithdraw = 8;
    await time.increaseTo(expectEpochStartTimestamps[epochWithdraw].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance = epoch <= epochWithdraw ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp} is ${dsecBalanceAfterAdd} instead of ${expectDsecBalance}`
      );
    }

    let removeDsec = await dsecDistribution.removeDsec(sampleAccount, sampleWithdrawAmount);
    let removeDsecBlockTimestamp = await testUtil.getBlockTimestamp(removeDsec.receipt.blockHash);

    const expectDsecRemoveEpoch = new BN(epochWithdraw);
    const expectRemoveDsec = new BN(web3.utils.toWei("3630104.583247938745152", "ether"));

    expectEvent(removeDsec, "DsecRemove", {
      account: sampleAccount,
      epoch: expectDsecRemoveEpoch,
      amount: sampleWithdrawAmount,
      timestamp: removeDsecBlockTimestamp,
      dsec: expectRemoveDsec,
    });

    const expectEpochWithdrawDsecBalanceAfterRemove = new BN(web3.utils.toWei("41125701.359225734234502400", "ether"));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterRemove = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance =
        epoch < epochWithdraw
          ? expectDsecBalanceAfterAdd
          : epoch == epochWithdraw
          ? expectEpochWithdrawDsecBalanceAfterRemove
          : new BN("0");

      assert.ok(
        dsecBalanceAfterRemove.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove} instead of ${expectDsecBalance}`
      );
    }

    for (let i = epochWithdraw; i < ExpectGovernanceForming.totalNumberOfEpochs; i++) {
      await time.increaseTo(expectEpochEndTimestamps[i]);

      for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
        const dsecBalanceAfterRemove = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
        const expectDsecBalance =
          epoch < epochWithdraw
            ? expectDsecBalanceAfterAdd
            : epoch <= i + 1
            ? expectEpochWithdrawDsecBalanceAfterRemove
            : new BN("0");

        assert.ok(
          dsecBalanceAfterRemove.eq(expectDsecBalance),
          `Index ${i} Epoch ${epoch}: dsecBalance after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove} instead of ${expectDsecBalance}`
        );
      }
    }
  });

  it("should return correct reward amount for user partial withdrawal in last epoch with deposit before epoch 0", async () => {
    const sampleAccount00 = accounts[2];
    const sampleAccount01 = accounts[3];
    const sampleDepositAmount = new BN(web3.utils.toWei("4103126.385642785037699000", "ether"));
    const sampleWithdrawAmount = new BN(web3.utils.toWei("545918.147922219402061000", "ether"));
    const expectDsecBalanceBeforeAdd = new BN("0");

    await time.increaseTo(expectEpochStartTimestamps[0].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceBeforeAdd00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceBeforeAdd01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      assert.ok(
        dsecBalanceBeforeAdd00.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd00} instead of ${expectDsecBalanceBeforeAdd}`
      );

      assert.ok(
        dsecBalanceBeforeAdd01.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd01} instead of ${expectDsecBalanceBeforeAdd}`
      );
    }

    let addDsec00 = await dsecDistribution.addDsec(sampleAccount00, sampleDepositAmount);
    let addDsecBlockTimestamp00 = await testUtil.getBlockTimestamp(addDsec00.receipt.blockHash);

    let addDsec01 = await dsecDistribution.addDsec(sampleAccount01, sampleDepositAmount);
    let addDsecBlockTimestamp01 = await testUtil.getBlockTimestamp(addDsec01.receipt.blockHash);

    const expectDsecAddEpoch = new BN("0");
    const expectAddDsec = new BN(web3.utils.toWei("4963141676073.5127816007104", "ether"));

    expectEvent(addDsec00, "DsecAdd", {
      account: sampleAccount00,
      epoch: expectDsecAddEpoch,
      amount: sampleDepositAmount,
      timestamp: addDsecBlockTimestamp00,
      dsec: expectAddDsec,
    });

    expectEvent(addDsec01, "DsecAdd", {
      account: sampleAccount01,
      epoch: expectDsecAddEpoch,
      amount: sampleDepositAmount,
      timestamp: addDsecBlockTimestamp01,
      dsec: expectAddDsec,
    });

    const expectDsecBalanceAfterAdd = expectAddDsec;

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceAfterAdd01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      const expectDsecBalance = epoch == 0 ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd00.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance for account 00 after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp00} is ${dsecBalanceAfterAdd00} instead of ${expectDsecBalance}`
      );

      assert.ok(
        dsecBalanceAfterAdd01.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance for account 01 after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp01} is ${dsecBalanceAfterAdd01} instead of ${expectDsecBalance}`
      );
    }

    const epochWithdraw = 9;
    await time.increaseTo(expectEpochStartTimestamps[epochWithdraw].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceAfterAdd01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      const expectDsecBalance = epoch <= epochWithdraw ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd00.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance for account 00 after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp00} is ${dsecBalanceAfterAdd00} instead of ${expectDsecBalance}`
      );

      assert.ok(
        dsecBalanceAfterAdd01.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance for account 01 after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp01} is ${dsecBalanceAfterAdd01} instead of ${expectDsecBalance}`
      );
    }

    let removeDsec = await dsecDistribution.removeDsec(sampleAccount00, sampleWithdrawAmount);
    let removeDsecBlockTimestamp = await testUtil.getBlockTimestamp(removeDsec.receipt.blockHash);

    const expectDsecRemoveEpoch = new BN(epochWithdraw);
    const expectRemoveDsec = new BN(web3.utils.toWei("660342591726.7165887329856", "ether"));

    expectEvent(removeDsec, "DsecRemove", {
      account: sampleAccount00,
      epoch: expectDsecRemoveEpoch,
      amount: sampleWithdrawAmount,
      timestamp: removeDsecBlockTimestamp,
      dsec: expectRemoveDsec,
    });

    const expectDsecBalanceAfterRemove = new BN(web3.utils.toWei("4302799084346.7961928677248", "ether"));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterRemove00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceAfterRemove01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      const expectDsecBalance00 =
        epoch < epochWithdraw
          ? expectDsecBalanceAfterAdd
          : epoch == epochWithdraw
          ? expectDsecBalanceAfterRemove
          : new BN("0");

      const expectDsecBalance01 = epoch <= epochWithdraw ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterRemove00.eq(expectDsecBalance00),
        `Epoch ${epoch}: dsecBalance for account 00 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove00} instead of ${expectDsecBalance00}`
      );

      assert.ok(
        dsecBalanceAfterRemove01.eq(expectDsecBalance01),
        `Epoch ${epoch}: dsecBalance for account 01 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove01} instead of ${expectDsecBalance01}`
      );
    }

    for (let i = epochWithdraw; i < ExpectGovernanceForming.totalNumberOfEpochs; i++) {
      await time.increaseTo(expectEpochEndTimestamps[i]);

      let removeDsecZero = await dsecDistribution.removeDsec(sampleAccount00, sampleWithdrawAmount);
      expectEvent.notEmitted(removeDsecZero, "DsecRemove");

      for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
        const dsecBalanceAfterRemove00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
        const dsecBalanceAfterRemove01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

        const expectDsecBalance00 =
          epoch < epochWithdraw
            ? expectDsecBalanceAfterAdd
            : epoch <= i + 1
            ? expectDsecBalanceAfterRemove
            : new BN("0");

        const expectDsecBalance01 = epoch <= i + 1 ? expectDsecBalanceAfterAdd : new BN("0");

        assert.ok(
          dsecBalanceAfterRemove00.eq(expectDsecBalance00),
          `Index ${i} Epoch ${epoch}: dsecBalance for account 00 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove00} instead of ${expectDsecBalance00}`
        );

        assert.ok(
          dsecBalanceAfterRemove01.eq(expectDsecBalance01),
          `Index ${i} Epoch ${epoch}: dsecBalance for account 01 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove01} instead of ${expectDsecBalance01}`
        );
      }
    }

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      let calculateRewardFor00 = await dsecDistribution.calculateRewardFor(
        sampleAccount00,
        epoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let estimateRewardForCurrentEpoch00 = await dsecDistribution.estimateRewardForCurrentEpoch(
        sampleAccount00,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let redeemDsec00 = await dsecDistribution.redeemDsec(sampleAccount00, epoch, DISTRIBUTION_AMOUNT_PER_EPOCH);

      let calculateRewardFor01 = await dsecDistribution.calculateRewardFor(
        sampleAccount01,
        epoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let estimateRewardForCurrentEpoch01 = await dsecDistribution.estimateRewardForCurrentEpoch(
        sampleAccount01,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let redeemDsec01 = await dsecDistribution.redeemDsec(sampleAccount01, epoch, DISTRIBUTION_AMOUNT_PER_EPOCH);

      const expectRewardAmount00 =
        epoch < epochWithdraw
          ? DISTRIBUTION_AMOUNT_PER_EPOCH.div(new BN("2"))
          : DISTRIBUTION_AMOUNT_PER_EPOCH.mul(expectDsecBalanceAfterRemove).div(
              expectDsecBalanceAfterAdd.add(expectDsecBalanceAfterRemove)
            );
      const expectRewardAmount01 =
        epoch < epochWithdraw
          ? DISTRIBUTION_AMOUNT_PER_EPOCH.div(new BN("2"))
          : DISTRIBUTION_AMOUNT_PER_EPOCH.mul(expectDsecBalanceAfterAdd).div(
              expectDsecBalanceAfterAdd.add(expectDsecBalanceAfterRemove)
            );

      const expectEstimateRewardForCurrentEpoch00 = new BN("0");
      const expectEstimateRewardForCurrentEpoch01 = new BN("0");

      assert.ok(
        calculateRewardFor00.eq(expectRewardAmount00),
        `Epoch ${epoch}: calculateRewardFor account 00 is ${calculateRewardFor00} instead of ${expectRewardAmount00}`
      );

      assert.ok(
        calculateRewardFor01.eq(expectRewardAmount01),
        `Epoch ${epoch}: calculateRewardFor account 01 is ${calculateRewardFor01} instead of ${expectRewardAmount01}`
      );

      assert.ok(
        estimateRewardForCurrentEpoch00.eq(expectEstimateRewardForCurrentEpoch00),
        `Epoch ${epoch}: estimateRewardForCurrentEpoch account 00 is ${estimateRewardForCurrentEpoch00} instead of ${expectEstimateRewardForCurrentEpoch00}`
      );

      assert.ok(
        estimateRewardForCurrentEpoch01.eq(expectEstimateRewardForCurrentEpoch01),
        `Epoch ${epoch}: estimateRewardForCurrentEpoch account 01 is ${estimateRewardForCurrentEpoch01} instead of ${expectEstimateRewardForCurrentEpoch01}`
      );

      expectEvent(redeemDsec00, "DsecRedeem", {
        account: sampleAccount00,
        epoch: new BN(epoch),
        distributionAmount: DISTRIBUTION_AMOUNT_PER_EPOCH,
        rewardAmount: expectRewardAmount00,
      });
      expectEvent(redeemDsec01, "DsecRedeem", {
        account: sampleAccount01,
        epoch: new BN(epoch),
        distributionAmount: DISTRIBUTION_AMOUNT_PER_EPOCH,
        rewardAmount: expectRewardAmount01,
      });
    }
  });

  it("should return correct reward amount for user partial withdrawal in same epoch before epoch 0", async () => {
    const sampleAccount = accounts[2];
    const sampleDepositAmount = new BN(web3.utils.toWei("4800000000.000000000000000012", "ether"));
    const sampleWithdrawAmount = new BN(web3.utils.toWei("4000000000.000000000000000010", "ether"));
    const expectDsecBalanceBeforeAdd = new BN("0");

    await time.increaseTo(expectEpochStartTimestamps[0].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceBeforeAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);

      assert.ok(
        dsecBalanceBeforeAdd.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd} instead of ${expectDsecBalanceBeforeAdd}`
      );
    }

    let addDsec = await dsecDistribution.addDsec(sampleAccount, sampleDepositAmount);
    let addDsecBlockTimestamp = await testUtil.getBlockTimestamp(addDsec.receipt.blockHash);

    const expectDsecAddEpoch = new BN("0");
    const expectAddDsec = new BN(web3.utils.toWei("5806080000000000.0000000000145152", "ether"));

    expectEvent(addDsec, "DsecAdd", {
      account: sampleAccount,
      epoch: expectDsecAddEpoch,
      amount: sampleDepositAmount,
      timestamp: addDsecBlockTimestamp,
      dsec: expectAddDsec,
    });

    const expectDsecBalanceAfterAdd = expectAddDsec;

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance = epoch == 0 ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp} is ${dsecBalanceAfterAdd} instead of ${expectDsecBalance}`
      );
    }

    let removeDsec = await dsecDistribution.removeDsec(sampleAccount, sampleWithdrawAmount);
    let removeDsecBlockTimestamp = await testUtil.getBlockTimestamp(removeDsec.receipt.blockHash);

    const expectDsecRemoveEpoch = new BN("0");
    const expectRemoveDsec = new BN(web3.utils.toWei("4838400000000000.000000000012096", "ether"));

    expectEvent(removeDsec, "DsecRemove", {
      account: sampleAccount,
      epoch: expectDsecRemoveEpoch,
      amount: sampleWithdrawAmount,
      timestamp: removeDsecBlockTimestamp,
      dsec: expectRemoveDsec,
    });

    const expectDsecBalanceAfterRemove = new BN(web3.utils.toWei("967680000000000.0000000000024192", "ether"));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterRemove = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
      const expectDsecBalance = epoch == 0 ? expectDsecBalanceAfterRemove : new BN("0");

      assert.ok(
        dsecBalanceAfterRemove.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove} instead of ${expectDsecBalance}`
      );
    }

    for (let i = 0; i < ExpectGovernanceForming.totalNumberOfEpochs; i++) {
      await time.increaseTo(expectEpochEndTimestamps[i]);

      for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
        const dsecBalanceAfterRemove = await dsecDistribution.dsecBalanceFor(sampleAccount, epoch);
        const expectDsecBalance = epoch <= i + 1 ? expectDsecBalanceAfterRemove : new BN("0");

        assert.ok(
          dsecBalanceAfterRemove.eq(expectDsecBalance),
          `Index ${i} Epoch ${epoch}: dsecBalance after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove} instead of ${expectDsecBalance}`
        );
      }
    }
  });

  it("should return correct reward amount for user partial withdrawal in interval with deposit before epoch 0", async () => {
    const sampleAccount00 = accounts[2];
    const sampleAccount01 = accounts[3];
    const sampleDepositAmount = new BN(web3.utils.toWei("4150.683759818333575000", "ether"));
    const sampleWithdrawAmount = new BN(web3.utils.toWei("3458.903133181944646000", "ether"));
    const expectDsecBalanceBeforeAdd = new BN("0");

    await time.increaseTo(expectEpochStartTimestamps[0].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceBeforeAdd00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceBeforeAdd01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      assert.ok(
        dsecBalanceBeforeAdd00.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd00} instead of ${expectDsecBalanceBeforeAdd}`
      );

      assert.ok(
        dsecBalanceBeforeAdd01.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd01} instead of ${expectDsecBalanceBeforeAdd}`
      );
    }

    let addDsec00 = await dsecDistribution.addDsec(sampleAccount00, sampleDepositAmount);
    let addDsecBlockTimestamp00 = await testUtil.getBlockTimestamp(addDsec00.receipt.blockHash);

    let addDsec01 = await dsecDistribution.addDsec(sampleAccount01, sampleDepositAmount);
    let addDsecBlockTimestamp01 = await testUtil.getBlockTimestamp(addDsec01.receipt.blockHash);

    const expectDsecAddEpoch = new BN("0");
    const expectAddDsec = new BN(web3.utils.toWei("5020667075.87625629232", "ether"));

    expectEvent(addDsec00, "DsecAdd", {
      account: sampleAccount00,
      epoch: expectDsecAddEpoch,
      amount: sampleDepositAmount,
      timestamp: addDsecBlockTimestamp00,
      dsec: expectAddDsec,
    });

    expectEvent(addDsec01, "DsecAdd", {
      account: sampleAccount01,
      epoch: expectDsecAddEpoch,
      amount: sampleDepositAmount,
      timestamp: addDsecBlockTimestamp01,
      dsec: expectAddDsec,
    });

    const expectDsecBalanceAfterAdd = expectAddDsec;

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceAfterAdd01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      const expectDsecBalance = epoch == 0 ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd00.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance for account 00 after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp00} is ${dsecBalanceAfterAdd00} instead of ${expectDsecBalance}`
      );

      assert.ok(
        dsecBalanceAfterAdd01.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance for account 01 after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp01} is ${dsecBalanceAfterAdd01} instead of ${expectDsecBalance}`
      );
    }

    const epochWithdraw = 7;
    await time.increaseTo(expectEpochStartTimestamps[epochWithdraw].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceAfterAdd01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      const expectDsecBalance = epoch <= epochWithdraw ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd00.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance for account 00 after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp00} is ${dsecBalanceAfterAdd00} instead of ${expectDsecBalance}`
      );

      assert.ok(
        dsecBalanceAfterAdd01.eq(expectDsecBalance),
        `Epoch ${epoch}: dsecBalance for account 01 after add of ${sampleDepositAmount} at ${addDsecBlockTimestamp01} is ${dsecBalanceAfterAdd01} instead of ${expectDsecBalance}`
      );
    }

    let removeDsec = await dsecDistribution.removeDsec(sampleAccount00, sampleWithdrawAmount);
    let removeDsecBlockTimestamp = await testUtil.getBlockTimestamp(removeDsec.receipt.blockHash);

    const expectDsecRemoveEpoch = new BN(epochWithdraw);
    const expectRemoveDsec = new BN(web3.utils.toWei("4183889229.8968802438016", "ether"));

    expectEvent(removeDsec, "DsecRemove", {
      account: sampleAccount00,
      epoch: expectDsecRemoveEpoch,
      amount: sampleWithdrawAmount,
      timestamp: removeDsecBlockTimestamp,
      dsec: expectRemoveDsec,
    });

    const expectEpochWithdrawDsecBalanceAfterRemove = new BN(web3.utils.toWei("836777845.9793760485184", "ether"));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterRemove00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceAfterRemove01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      const expectDsecBalance00 =
        epoch < epochWithdraw
          ? expectDsecBalanceAfterAdd
          : epoch == epochWithdraw
          ? expectEpochWithdrawDsecBalanceAfterRemove
          : new BN("0");

      const expectDsecBalance01 = epoch <= epochWithdraw ? expectDsecBalanceAfterAdd : new BN("0");

      assert.ok(
        dsecBalanceAfterRemove00.eq(expectDsecBalance00),
        `Epoch ${epoch}: dsecBalance for account 00 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove00} instead of ${expectDsecBalance00}`
      );

      assert.ok(
        dsecBalanceAfterRemove01.eq(expectDsecBalance01),
        `Epoch ${epoch}: dsecBalance for account 01 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove01} instead of ${expectDsecBalance01}`
      );
    }

    for (let i = epochWithdraw; i < ExpectGovernanceForming.totalNumberOfEpochs; i++) {
      await time.increaseTo(expectEpochEndTimestamps[i]);

      for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
        const dsecBalanceAfterRemove00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
        const dsecBalanceAfterRemove01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

        const expectDsecBalance00 =
          epoch < epochWithdraw
            ? expectDsecBalanceAfterAdd
            : epoch <= i + 1
            ? expectEpochWithdrawDsecBalanceAfterRemove
            : new BN("0");

        const expectDsecBalance01 = epoch <= i + 1 ? expectDsecBalanceAfterAdd : new BN("0");

        assert.ok(
          dsecBalanceAfterRemove00.eq(expectDsecBalance00),
          `Index ${i} Epoch ${epoch}: dsecBalance for account 00 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove00} instead of ${expectDsecBalance00}`
        );

        assert.ok(
          dsecBalanceAfterRemove01.eq(expectDsecBalance01),
          `Index ${i} Epoch ${epoch}: dsecBalance for account 01 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove01} instead of ${expectDsecBalance01}`
        );
      }
    }

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      let calculateRewardFor00 = await dsecDistribution.calculateRewardFor(
        sampleAccount00,
        epoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let estimateRewardForCurrentEpoch00 = await dsecDistribution.estimateRewardForCurrentEpoch(
        sampleAccount00,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let redeemDsec00 = await dsecDistribution.redeemDsec(sampleAccount00, epoch, DISTRIBUTION_AMOUNT_PER_EPOCH);

      let calculateRewardFor01 = await dsecDistribution.calculateRewardFor(
        sampleAccount01,
        epoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let estimateRewardForCurrentEpoch01 = await dsecDistribution.estimateRewardForCurrentEpoch(
        sampleAccount01,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let redeemDsec01 = await dsecDistribution.redeemDsec(sampleAccount01, epoch, DISTRIBUTION_AMOUNT_PER_EPOCH);

      const expectRewardAmount00 =
        epoch < epochWithdraw
          ? DISTRIBUTION_AMOUNT_PER_EPOCH.div(new BN("2"))
          : expectEpochWithdrawDsecBalanceAfterRemove
              .mul(DISTRIBUTION_AMOUNT_PER_EPOCH)
              .div(expectEpochWithdrawDsecBalanceAfterRemove.add(expectDsecBalanceAfterAdd));

      const expectRewardAmount01 =
        epoch < epochWithdraw
          ? DISTRIBUTION_AMOUNT_PER_EPOCH.div(new BN("2"))
          : expectDsecBalanceAfterAdd
              .mul(DISTRIBUTION_AMOUNT_PER_EPOCH)
              .div(expectEpochWithdrawDsecBalanceAfterRemove.add(expectDsecBalanceAfterAdd));

      const expectEstimateRewardForCurrentEpoch00 = new BN("0");
      const expectEstimateRewardForCurrentEpoch01 = new BN("0");

      assert.ok(
        calculateRewardFor00.eq(expectRewardAmount00),
        `Epoch ${epoch}: calculateRewardFor account 00 is ${calculateRewardFor00} instead of ${expectRewardAmount00}`
      );

      assert.ok(
        calculateRewardFor01.eq(expectRewardAmount01),
        `Epoch ${epoch}: calculateRewardFor account 01 is ${calculateRewardFor01} instead of ${expectRewardAmount01}`
      );

      assert.ok(
        estimateRewardForCurrentEpoch00.eq(expectEstimateRewardForCurrentEpoch00),
        `Epoch ${epoch}: estimateRewardForCurrentEpoch account 00 is ${estimateRewardForCurrentEpoch00} instead of ${expectEstimateRewardForCurrentEpoch00}`
      );

      assert.ok(
        estimateRewardForCurrentEpoch01.eq(expectEstimateRewardForCurrentEpoch01),
        `Epoch ${epoch}: estimateRewardForCurrentEpoch account 01 is ${estimateRewardForCurrentEpoch01} instead of ${expectEstimateRewardForCurrentEpoch01}`
      );

      expectEvent(redeemDsec00, "DsecRedeem", {
        account: sampleAccount00,
        epoch: new BN(epoch),
        distributionAmount: DISTRIBUTION_AMOUNT_PER_EPOCH,
        rewardAmount: expectRewardAmount00,
      });

      expectEvent(redeemDsec01, "DsecRedeem", {
        account: sampleAccount01,
        epoch: new BN(epoch),
        distributionAmount: DISTRIBUTION_AMOUNT_PER_EPOCH,
        rewardAmount: expectRewardAmount01,
      });
    }
  });

  it("should return correct reward amount for user partial withdrawal in single epoch", async () => {
    const sampleAccount00 = accounts[2];
    const sampleAccount01 = accounts[3];
    const sampleDepositAmount00 = new BN(web3.utils.toWei("737139652.400161396363668000", "ether"));
    const sampleDepositAmount01 = new BN(web3.utils.toWei("676097996.552094292236323000", "ether"));
    const sampleWithdrawAmount = new BN(web3.utils.toWei("623896061.327787160331859000", "ether"));
    const depositWithdrawEpoch = 7;
    const depositTimestamp00 = expectEpochStartTimestamps[depositWithdrawEpoch].add(new BN("116410"));
    const depositTimestamp01 = expectEpochStartTimestamps[depositWithdrawEpoch].add(new BN("357641"));
    const withdrawTimestamp = expectEpochStartTimestamps[depositWithdrawEpoch].add(new BN("359517"));
    const expectDsecBalanceBeforeAdd = new BN("0");

    await time.increaseTo(expectEpochStartTimestamps[0].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceBeforeAdd00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceBeforeAdd01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      assert.ok(
        dsecBalanceBeforeAdd00.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd00} instead of ${expectDsecBalanceBeforeAdd}`
      );

      assert.ok(
        dsecBalanceBeforeAdd01.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd01} instead of ${expectDsecBalanceBeforeAdd}`
      );
    }

    await time.increaseTo(depositTimestamp00);

    const addDsec00 = await dsecDistribution.addDsec(sampleAccount00, sampleDepositAmount00);
    const addDsecBlockTimestamp00 = await testUtil.getBlockTimestamp(addDsec00.receipt.blockHash);

    const expectDsecAddEpoch00 = new BN(depositWithdrawEpoch);
    const expectAddDsec00 = sampleDepositAmount00.mul(
      expectEpochEndTimestamps[depositWithdrawEpoch].sub(addDsecBlockTimestamp00)
    );

    expectEvent(addDsec00, "DsecAdd", {
      account: sampleAccount00,
      epoch: expectDsecAddEpoch00,
      amount: sampleDepositAmount00,
      timestamp: addDsecBlockTimestamp00,
      dsec: expectAddDsec00,
    });

    await time.increaseTo(depositTimestamp01);

    const addDsec01 = await dsecDistribution.addDsec(sampleAccount01, sampleDepositAmount01);
    const addDsecBlockTimestamp01 = await testUtil.getBlockTimestamp(addDsec01.receipt.blockHash);

    const expectDsecAddEpoch01 = new BN(depositWithdrawEpoch);
    const expectAddDsec01 = sampleDepositAmount01.mul(
      expectEpochEndTimestamps[depositWithdrawEpoch].sub(addDsecBlockTimestamp01)
    );

    expectEvent(addDsec01, "DsecAdd", {
      account: sampleAccount01,
      epoch: expectDsecAddEpoch01,
      amount: sampleDepositAmount01,
      timestamp: addDsecBlockTimestamp01,
      dsec: expectAddDsec01,
    });

    const expectDsecBalanceAfterAdd00 = expectAddDsec00;
    const expectDsecBalanceAfterAdd01 = expectAddDsec01;

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceAfterAdd01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      const expectDsecBalance00 = epoch == depositWithdrawEpoch ? expectDsecBalanceAfterAdd00 : new BN("0");
      const expectDsecBalance01 = epoch == depositWithdrawEpoch ? expectDsecBalanceAfterAdd01 : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd00.eq(expectDsecBalance00),
        `Epoch ${epoch}: dsecBalance for account 00 after add of ${sampleDepositAmount00} at ${addDsecBlockTimestamp00} is ${dsecBalanceAfterAdd00} instead of ${expectDsecBalance00}`
      );

      assert.ok(
        dsecBalanceAfterAdd01.eq(expectDsecBalance01),
        `Epoch ${epoch}: dsecBalance for account 01 after add of ${sampleDepositAmount01} at ${addDsecBlockTimestamp01} is ${dsecBalanceAfterAdd01} instead of ${expectDsecBalance01}`
      );
    }

    await time.increaseTo(withdrawTimestamp);

    const removeDsec = await dsecDistribution.removeDsec(sampleAccount00, sampleWithdrawAmount);
    const removeDsecBlockTimestamp = await testUtil.getBlockTimestamp(removeDsec.receipt.blockHash);

    const expectDsecRemoveEpoch = new BN(depositWithdrawEpoch);
    const expectRemoveDsec = sampleWithdrawAmount
      .mul(expectEpochEndTimestamps[depositWithdrawEpoch].sub(removeDsecBlockTimestamp))
      .mul(new BN("12"))
      .div(new BN("10"));

    expectEvent(removeDsec, "DsecRemove", {
      account: sampleAccount00,
      epoch: expectDsecRemoveEpoch,
      amount: sampleWithdrawAmount,
      timestamp: removeDsecBlockTimestamp,
      dsec: expectRemoveDsec,
    });

    const expectEpochWithdrawDsecBalanceAfterRemove = expectDsecBalanceAfterAdd00.sub(expectRemoveDsec);

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterRemove00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceAfterRemove01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      const expectDsecBalance00 =
        epoch == depositWithdrawEpoch ? expectEpochWithdrawDsecBalanceAfterRemove : new BN("0");

      const expectDsecBalance01 = epoch == depositWithdrawEpoch ? expectDsecBalanceAfterAdd01 : new BN("0");

      assert.ok(
        dsecBalanceAfterRemove00.eq(expectDsecBalance00),
        `Epoch ${epoch}: dsecBalance for account 00 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove00} instead of ${expectDsecBalance00}`
      );

      assert.ok(
        dsecBalanceAfterRemove01.eq(expectDsecBalance01),
        `Epoch ${epoch}: dsecBalance for account 01 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove01} instead of ${expectDsecBalance01}`
      );
    }

    const expectFutureDsecBalanceAfterAdd00 = sampleDepositAmount00.mul(
      expectEpochEndTimestamps[depositWithdrawEpoch].sub(expectEpochStartTimestamps[depositWithdrawEpoch])
    );
    const expectFutureDsecBalanceAfterAdd01 = sampleDepositAmount01.mul(
      expectEpochEndTimestamps[depositWithdrawEpoch].sub(expectEpochStartTimestamps[depositWithdrawEpoch])
    );
    const expectRemoveFutureDsec = sampleWithdrawAmount.mul(
      expectEpochEndTimestamps[depositWithdrawEpoch].sub(expectEpochStartTimestamps[depositWithdrawEpoch])
    );
    const expectAfterEpochWithdrawDsecBalanceAfterRemove =
      expectFutureDsecBalanceAfterAdd00.sub(expectRemoveFutureDsec);

    for (let i = depositWithdrawEpoch; i < ExpectGovernanceForming.totalNumberOfEpochs; i++) {
      await time.increaseTo(expectEpochEndTimestamps[i]);

      for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
        const dsecBalanceAfterRemove00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
        const dsecBalanceAfterRemove01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

        const expectDsecBalance00 =
          epoch <= i + 1
            ? epoch < depositWithdrawEpoch
              ? new BN("0")
              : epoch == depositWithdrawEpoch
              ? expectEpochWithdrawDsecBalanceAfterRemove
              : expectAfterEpochWithdrawDsecBalanceAfterRemove
            : new BN("0");

        const expectDsecBalance01 =
          epoch <= i + 1
            ? epoch < depositWithdrawEpoch
              ? new BN("0")
              : epoch == depositWithdrawEpoch
              ? expectDsecBalanceAfterAdd01
              : expectFutureDsecBalanceAfterAdd01
            : new BN("0");

        assert.ok(
          dsecBalanceAfterRemove00.eq(expectDsecBalance00),
          `Index ${i} Epoch ${epoch}: dsecBalance for account 00 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove00} instead of ${expectDsecBalance00}`
        );

        assert.ok(
          dsecBalanceAfterRemove01.eq(expectDsecBalance01),
          `Index ${i} Epoch ${epoch}: dsecBalance for account 01 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove01} instead of ${expectDsecBalance01}`
        );
      }
    }

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      let calculateRewardFor00 = await dsecDistribution.calculateRewardFor(
        sampleAccount00,
        epoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let estimateRewardForCurrentEpoch00 = await dsecDistribution.estimateRewardForCurrentEpoch(
        sampleAccount00,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let redeemDsec00 = await dsecDistribution.redeemDsec(sampleAccount00, epoch, DISTRIBUTION_AMOUNT_PER_EPOCH);

      let calculateRewardFor01 = await dsecDistribution.calculateRewardFor(
        sampleAccount01,
        epoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let estimateRewardForCurrentEpoch01 = await dsecDistribution.estimateRewardForCurrentEpoch(
        sampleAccount01,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let redeemDsec01 = await dsecDistribution.redeemDsec(sampleAccount01, epoch, DISTRIBUTION_AMOUNT_PER_EPOCH);

      const expectRewardAmount00 =
        epoch < depositWithdrawEpoch
          ? new BN("0")
          : epoch == depositWithdrawEpoch
          ? expectEpochWithdrawDsecBalanceAfterRemove
              .mul(DISTRIBUTION_AMOUNT_PER_EPOCH)
              .div(expectEpochWithdrawDsecBalanceAfterRemove.add(expectDsecBalanceAfterAdd01))
          : expectAfterEpochWithdrawDsecBalanceAfterRemove
              .mul(DISTRIBUTION_AMOUNT_PER_EPOCH)
              .div(expectAfterEpochWithdrawDsecBalanceAfterRemove.add(expectFutureDsecBalanceAfterAdd01));

      const expectRewardAmount01 =
        epoch < depositWithdrawEpoch
          ? new BN("0")
          : epoch == depositWithdrawEpoch
          ? expectDsecBalanceAfterAdd01
              .mul(DISTRIBUTION_AMOUNT_PER_EPOCH)
              .div(expectEpochWithdrawDsecBalanceAfterRemove.add(expectDsecBalanceAfterAdd01))
          : expectFutureDsecBalanceAfterAdd01
              .mul(DISTRIBUTION_AMOUNT_PER_EPOCH)
              .div(expectAfterEpochWithdrawDsecBalanceAfterRemove.add(expectFutureDsecBalanceAfterAdd01));

      const expectEstimateRewardForCurrentEpoch00 = new BN("0");
      const expectEstimateRewardForCurrentEpoch01 = new BN("0");

      assert.ok(
        calculateRewardFor00.eq(expectRewardAmount00),
        `Epoch ${epoch}: calculateRewardFor account 00 is ${calculateRewardFor00} instead of ${expectRewardAmount00}`
      );

      assert.ok(
        calculateRewardFor01.eq(expectRewardAmount01),
        `Epoch ${epoch}: calculateRewardFor account 01 is ${calculateRewardFor01} instead of ${expectRewardAmount01}`
      );

      assert.ok(
        estimateRewardForCurrentEpoch00.eq(expectEstimateRewardForCurrentEpoch00),
        `Epoch ${epoch}: estimateRewardForCurrentEpoch account 00 is ${estimateRewardForCurrentEpoch00} instead of ${expectEstimateRewardForCurrentEpoch00}`
      );

      assert.ok(
        estimateRewardForCurrentEpoch01.eq(expectEstimateRewardForCurrentEpoch01),
        `Epoch ${epoch}: estimateRewardForCurrentEpoch account 01 is ${estimateRewardForCurrentEpoch01} instead of ${expectEstimateRewardForCurrentEpoch01}`
      );

      if (epoch >= depositWithdrawEpoch) {
        expectEvent(redeemDsec00, "DsecRedeem", {
          account: sampleAccount00,
          epoch: new BN(epoch),
          distributionAmount: DISTRIBUTION_AMOUNT_PER_EPOCH,
          rewardAmount: expectRewardAmount00,
        });

        expectEvent(redeemDsec01, "DsecRedeem", {
          account: sampleAccount01,
          epoch: new BN(epoch),
          distributionAmount: DISTRIBUTION_AMOUNT_PER_EPOCH,
          rewardAmount: expectRewardAmount01,
        });
      }
    }
  });

  it("should return correct reward amount of 0 with penalty for user partial withdrawal in single epoch", async () => {
    const sampleAccount00 = accounts[2];
    const sampleAccount01 = accounts[3];
    const sampleDepositAmount00 = new BN(web3.utils.toWei("897159920.600368578393417000", "ether"));
    const sampleDepositAmount01 = new BN(web3.utils.toWei("140874132.114467856487040000", "ether"));
    const sampleWithdrawAmount = new BN(web3.utils.toWei("805698297.81509903580941100", "ether"));
    const depositWithdrawEpoch = 3;
    const depositTimestamp00 = expectEpochStartTimestamps[depositWithdrawEpoch].add(new BN("166902"));
    const depositTimestamp01 = expectEpochStartTimestamps[depositWithdrawEpoch].add(new BN("175701"));
    const withdrawTimestamp = expectEpochStartTimestamps[depositWithdrawEpoch].add(new BN("198450"));
    const expectDsecBalanceBeforeAdd = new BN("0");

    await time.increaseTo(expectEpochStartTimestamps[0].sub(new BN(EPOCH_START_LEAD_TIME_SECS)));

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceBeforeAdd00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceBeforeAdd01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      assert.ok(
        dsecBalanceBeforeAdd00.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd00} instead of ${expectDsecBalanceBeforeAdd}`
      );

      assert.ok(
        dsecBalanceBeforeAdd01.eq(expectDsecBalanceBeforeAdd),
        `Epoch ${epoch}: dsecBalance before add is ${dsecBalanceBeforeAdd01} instead of ${expectDsecBalanceBeforeAdd}`
      );
    }

    await time.increaseTo(depositTimestamp00);

    const addDsec00 = await dsecDistribution.addDsec(sampleAccount00, sampleDepositAmount00);
    const addDsecBlockTimestamp00 = await testUtil.getBlockTimestamp(addDsec00.receipt.blockHash);

    const expectDsecAddEpoch00 = new BN(depositWithdrawEpoch);
    const expectAddDsec00 = sampleDepositAmount00.mul(
      expectEpochEndTimestamps[depositWithdrawEpoch].sub(addDsecBlockTimestamp00)
    );

    expectEvent(addDsec00, "DsecAdd", {
      account: sampleAccount00,
      epoch: expectDsecAddEpoch00,
      amount: sampleDepositAmount00,
      timestamp: addDsecBlockTimestamp00,
      dsec: expectAddDsec00,
    });

    await time.increaseTo(depositTimestamp01);

    const addDsec01 = await dsecDistribution.addDsec(sampleAccount01, sampleDepositAmount01);
    const addDsecBlockTimestamp01 = await testUtil.getBlockTimestamp(addDsec01.receipt.blockHash);

    const expectDsecAddEpoch01 = new BN(depositWithdrawEpoch);
    const expectAddDsec01 = sampleDepositAmount01.mul(
      expectEpochEndTimestamps[depositWithdrawEpoch].sub(addDsecBlockTimestamp01)
    );

    expectEvent(addDsec01, "DsecAdd", {
      account: sampleAccount01,
      epoch: expectDsecAddEpoch01,
      amount: sampleDepositAmount01,
      timestamp: addDsecBlockTimestamp01,
      dsec: expectAddDsec01,
    });

    const expectDsecBalanceAfterAdd00 = expectAddDsec00;
    const expectDsecBalanceAfterAdd01 = expectAddDsec01;

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterAdd00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceAfterAdd01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      const expectDsecBalance00 = epoch == depositWithdrawEpoch ? expectDsecBalanceAfterAdd00 : new BN("0");
      const expectDsecBalance01 = epoch == depositWithdrawEpoch ? expectDsecBalanceAfterAdd01 : new BN("0");

      assert.ok(
        dsecBalanceAfterAdd00.eq(expectDsecBalance00),
        `Epoch ${epoch}: dsecBalance for account 00 after add of ${sampleDepositAmount00} at ${addDsecBlockTimestamp00} is ${dsecBalanceAfterAdd00} instead of ${expectDsecBalance00}`
      );

      assert.ok(
        dsecBalanceAfterAdd01.eq(expectDsecBalance01),
        `Epoch ${epoch}: dsecBalance for account 01 after add of ${sampleDepositAmount01} at ${addDsecBlockTimestamp01} is ${dsecBalanceAfterAdd01} instead of ${expectDsecBalance01}`
      );
    }

    await time.increaseTo(withdrawTimestamp);

    const removeDsec = await dsecDistribution.removeDsec(sampleAccount00, sampleWithdrawAmount);
    const removeDsecBlockTimestamp = await testUtil.getBlockTimestamp(removeDsec.receipt.blockHash);

    const expectDsecRemoveEpoch = new BN(depositWithdrawEpoch);
    const expectRemoveDsec = expectAddDsec00;

    expectEvent(removeDsec, "DsecRemove", {
      account: sampleAccount00,
      epoch: expectDsecRemoveEpoch,
      amount: sampleWithdrawAmount,
      timestamp: removeDsecBlockTimestamp,
      dsec: expectRemoveDsec,
    });

    const expectEpochWithdrawDsecBalanceAfterRemove = new BN("0");

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      const dsecBalanceAfterRemove00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
      const dsecBalanceAfterRemove01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

      const expectDsecBalance00 =
        epoch == depositWithdrawEpoch ? expectEpochWithdrawDsecBalanceAfterRemove : new BN("0");

      const expectDsecBalance01 = epoch == depositWithdrawEpoch ? expectDsecBalanceAfterAdd01 : new BN("0");

      assert.ok(
        dsecBalanceAfterRemove00.eq(expectDsecBalance00),
        `Epoch ${epoch}: dsecBalance for account 00 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove00} instead of ${expectDsecBalance00}`
      );

      assert.ok(
        dsecBalanceAfterRemove01.eq(expectDsecBalance01),
        `Epoch ${epoch}: dsecBalance for account 01 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove01} instead of ${expectDsecBalance01}`
      );
    }

    const removeDsecZero = await dsecDistribution.removeDsec(sampleAccount00, sampleWithdrawAmount);
    expectEvent.notEmitted(removeDsecZero, "DsecRemove");

    const expectFutureDsecBalanceAfterAdd00 = sampleDepositAmount00.mul(
      expectEpochEndTimestamps[depositWithdrawEpoch].sub(expectEpochStartTimestamps[depositWithdrawEpoch])
    );
    const expectFutureDsecBalanceAfterAdd01 = sampleDepositAmount01.mul(
      expectEpochEndTimestamps[depositWithdrawEpoch].sub(expectEpochStartTimestamps[depositWithdrawEpoch])
    );
    const expectRemoveFutureDsec = sampleWithdrawAmount.mul(
      expectEpochEndTimestamps[depositWithdrawEpoch].sub(expectEpochStartTimestamps[depositWithdrawEpoch])
    );
    const expectAfterEpochWithdrawDsecBalanceAfterRemove =
      expectFutureDsecBalanceAfterAdd00.sub(expectRemoveFutureDsec);

    for (let i = depositWithdrawEpoch; i < ExpectGovernanceForming.totalNumberOfEpochs; i++) {
      await time.increaseTo(expectEpochEndTimestamps[i]);

      for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
        const dsecBalanceAfterRemove00 = await dsecDistribution.dsecBalanceFor(sampleAccount00, epoch);
        const dsecBalanceAfterRemove01 = await dsecDistribution.dsecBalanceFor(sampleAccount01, epoch);

        const expectDsecBalance00 =
          epoch <= i + 1
            ? epoch < depositWithdrawEpoch
              ? new BN("0")
              : epoch == depositWithdrawEpoch
              ? expectEpochWithdrawDsecBalanceAfterRemove
              : expectAfterEpochWithdrawDsecBalanceAfterRemove
            : new BN("0");

        const expectDsecBalance01 =
          epoch <= i + 1
            ? epoch < depositWithdrawEpoch
              ? new BN("0")
              : epoch == depositWithdrawEpoch
              ? expectDsecBalanceAfterAdd01
              : expectFutureDsecBalanceAfterAdd01
            : new BN("0");

        assert.ok(
          dsecBalanceAfterRemove00.eq(expectDsecBalance00),
          `Index ${i} Epoch ${epoch}: dsecBalance for account 00 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove00} instead of ${expectDsecBalance00}`
        );

        assert.ok(
          dsecBalanceAfterRemove01.eq(expectDsecBalance01),
          `Index ${i} Epoch ${epoch}: dsecBalance for account 01 after remove of ${sampleWithdrawAmount} at ${removeDsecBlockTimestamp} is ${dsecBalanceAfterRemove01} instead of ${expectDsecBalance01}`
        );
      }
    }

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      let calculateRewardFor00 = await dsecDistribution.calculateRewardFor(
        sampleAccount00,
        epoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let estimateRewardForCurrentEpoch00 = await dsecDistribution.estimateRewardForCurrentEpoch(
        sampleAccount00,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let redeemDsec00 = await dsecDistribution.redeemDsec(sampleAccount00, epoch, DISTRIBUTION_AMOUNT_PER_EPOCH);

      let calculateRewardFor01 = await dsecDistribution.calculateRewardFor(
        sampleAccount01,
        epoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let estimateRewardForCurrentEpoch01 = await dsecDistribution.estimateRewardForCurrentEpoch(
        sampleAccount01,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let redeemDsec01 = await dsecDistribution.redeemDsec(sampleAccount01, epoch, DISTRIBUTION_AMOUNT_PER_EPOCH);

      const expectRewardAmount00 =
        epoch < depositWithdrawEpoch
          ? new BN("0")
          : epoch == depositWithdrawEpoch
          ? expectEpochWithdrawDsecBalanceAfterRemove
              .mul(DISTRIBUTION_AMOUNT_PER_EPOCH)
              .div(expectEpochWithdrawDsecBalanceAfterRemove.add(expectDsecBalanceAfterAdd01))
          : expectAfterEpochWithdrawDsecBalanceAfterRemove
              .mul(DISTRIBUTION_AMOUNT_PER_EPOCH)
              .div(expectAfterEpochWithdrawDsecBalanceAfterRemove.add(expectFutureDsecBalanceAfterAdd01));

      const expectRewardAmount01 =
        epoch < depositWithdrawEpoch
          ? new BN("0")
          : epoch == depositWithdrawEpoch
          ? expectDsecBalanceAfterAdd01
              .mul(DISTRIBUTION_AMOUNT_PER_EPOCH)
              .div(expectEpochWithdrawDsecBalanceAfterRemove.add(expectDsecBalanceAfterAdd01))
          : expectFutureDsecBalanceAfterAdd01
              .mul(DISTRIBUTION_AMOUNT_PER_EPOCH)
              .div(expectAfterEpochWithdrawDsecBalanceAfterRemove.add(expectFutureDsecBalanceAfterAdd01));

      const expectEstimateRewardForCurrentEpoch00 = new BN("0");
      const expectEstimateRewardForCurrentEpoch01 = new BN("0");

      assert.ok(
        calculateRewardFor00.eq(expectRewardAmount00),
        `Epoch ${epoch}: calculateRewardFor account 00 is ${calculateRewardFor00} instead of ${expectRewardAmount00}`
      );

      assert.ok(
        calculateRewardFor01.eq(expectRewardAmount01),
        `Epoch ${epoch}: calculateRewardFor account 01 is ${calculateRewardFor01} instead of ${expectRewardAmount01}`
      );

      assert.ok(
        estimateRewardForCurrentEpoch00.eq(expectEstimateRewardForCurrentEpoch00),
        `Epoch ${epoch}: estimateRewardForCurrentEpoch account 00 is ${estimateRewardForCurrentEpoch00} instead of ${expectEstimateRewardForCurrentEpoch00}`
      );

      assert.ok(
        estimateRewardForCurrentEpoch01.eq(expectEstimateRewardForCurrentEpoch01),
        `Epoch ${epoch}: estimateRewardForCurrentEpoch account 01 is ${estimateRewardForCurrentEpoch01} instead of ${expectEstimateRewardForCurrentEpoch01}`
      );

      if (epoch > depositWithdrawEpoch) {
        expectEvent(redeemDsec00, "DsecRedeem", {
          account: sampleAccount00,
          epoch: new BN(epoch),
          distributionAmount: DISTRIBUTION_AMOUNT_PER_EPOCH,
          rewardAmount: expectRewardAmount00,
        });

        expectEvent(redeemDsec01, "DsecRedeem", {
          account: sampleAccount01,
          epoch: new BN(epoch),
          distributionAmount: DISTRIBUTION_AMOUNT_PER_EPOCH,
          rewardAmount: expectRewardAmount01,
        });
      }
    }
  });

  it("should return correct values during governance forming period", async () => {
    const expectCurrentEpochTimestamps = [
      {
        depositAmounts: [
          new BN(web3.utils.toWei("2547251068.087163465703372200", "ether")),
          new BN(web3.utils.toWei("244676.454037984876229000", "ether")),
          new BN(web3.utils.toWei("0.251675054586676000", "ether")),
          new BN(web3.utils.toWei("796581.976778056427420000", "ether")),
          new BN(web3.utils.toWei("482.324220628308687000", "ether")),
        ],
        startOfEpoch: new BN("1640390400"),
        midOfEpoch: new BN("1640532657"),
        endOfEpoch: new BN("1641600000"),
        midOfInterval: new BN("1641647447"),
        endOfInterval: new BN("1641686400"),
      },
      {
        depositAmounts: [
          new BN(web3.utils.toWei("0.810858205668796000", "ether")),
          new BN(web3.utils.toWei("3384750.004093560935785050", "ether")),
          new BN(web3.utils.toWei("22962.499833637768028000", "ether")),
          new BN(web3.utils.toWei("841190.629523383346778000", "ether")),
          new BN(web3.utils.toWei("64065.558548193698830000", "ether")),
        ],
        startOfEpoch: new BN("1641686400"),
        midOfEpoch: new BN("1642511802"),
        endOfEpoch: new BN("1642896000"),
        midOfInterval: new BN("1642919910"),
        endOfInterval: new BN("1642982400"),
      },
      {
        depositAmounts: [
          new BN(web3.utils.toWei("3664163838.589418053115234000", "ether")),
          new BN(web3.utils.toWei("24008.256311341976578000", "ether")),
          new BN(web3.utils.toWei("357762.680259200201314000", "ether")),
          new BN(web3.utils.toWei("2987.534201335967418000", "ether")),
          new BN(web3.utils.toWei("162.040346738807836100", "ether")),
        ],
        startOfEpoch: new BN("1642982400"),
        midOfEpoch: new BN("1643479389"),
        endOfEpoch: new BN("1644192000"),
        midOfInterval: new BN("1644238850"),
        endOfInterval: new BN("1644278400"),
      },
      {
        depositAmounts: [
          new BN(web3.utils.toWei("18042242790.666403205516556000", "ether")),
          new BN(web3.utils.toWei("2303.223376290134084000", "ether")),
          new BN(web3.utils.toWei("305.450455761557730000", "ether")),
          new BN(web3.utils.toWei("189918.967567726062764000", "ether")),
          new BN(web3.utils.toWei("449307.414034654157241000", "ether")),
        ],
        startOfEpoch: new BN("1644278400"),
        midOfEpoch: new BN("1644323563"),
        endOfEpoch: new BN("1645488000"),
        midOfInterval: new BN("1645530360"),
        endOfInterval: new BN("1645574400"),
      },
      {
        depositAmounts: [
          new BN(web3.utils.toWei("225264659.419936816028615000", "ether")),
          new BN(web3.utils.toWei("27315.085397422584413500", "ether")),
          new BN(web3.utils.toWei("417602.911746556510760000", "ether")),
          new BN(web3.utils.toWei("28549.260474990977916000", "ether")),
          new BN(web3.utils.toWei("172982.001010271630437760", "ether")),
        ],
        startOfEpoch: new BN("1645574400"),
        midOfEpoch: new BN("1645944552"),
        endOfEpoch: new BN("1646784000"),
        midOfInterval: new BN("1646794010"),
        endOfInterval: new BN("1646870400"),
      },
      {
        depositAmounts: [
          new BN(web3.utils.toWei("3790.367854085231257000", "ether")),
          new BN(web3.utils.toWei("450708.268817843782402000", "ether")),
          new BN(web3.utils.toWei("470461.999964590472247000", "ether")),
          new BN(web3.utils.toWei("63634.124436152104539000", "ether")),
          new BN(web3.utils.toWei("392043.500669475272490000", "ether")),
        ],
        startOfEpoch: new BN("1646870400"),
        midOfEpoch: new BN("1647597716"),
        endOfEpoch: new BN("1648080000"),
        midOfInterval: new BN("1648086708"),
        endOfInterval: new BN("1648166400"),
      },
      {
        depositAmounts: [
          new BN(web3.utils.toWei("85.957584249981448000", "ether")),
          new BN(web3.utils.toWei("352657.451099408833621000", "ether")),
          new BN(web3.utils.toWei("45579.554989070797913000", "ether")),
          new BN(web3.utils.toWei("438475.895881231417901000", "ether")),
          new BN(web3.utils.toWei("280766.461770625486622000", "ether")),
        ],
        startOfEpoch: new BN("1648166400"),
        midOfEpoch: new BN("1648457342"),
        endOfEpoch: new BN("1649376000"),
        midOfInterval: new BN("1649398256"),
        endOfInterval: new BN("1649462400"),
      },
      {
        depositAmounts: [
          new BN(web3.utils.toWei("4824578169.920738220465296000", "ether")),
          new BN(web3.utils.toWei("181005.380586726079813000", "ether")),
          new BN(web3.utils.toWei("82407.106696253168849000", "ether")),
          new BN(web3.utils.toWei("123175.405600844378700000", "ether")),
          new BN(web3.utils.toWei("4.278237332494022000", "ether")),
        ],
        startOfEpoch: new BN("1649462400"),
        midOfEpoch: new BN("1650173152"),
        endOfEpoch: new BN("1650672000"),
        midOfInterval: new BN("1650744516"),
        endOfInterval: new BN("1650758400"),
      },
      {
        depositAmounts: [
          new BN(web3.utils.toWei("183317399.450575146655794000", "ether")),
          new BN(web3.utils.toWei("455972.046288203252274400", "ether")),
          new BN(web3.utils.toWei("261969.826097600144132000", "ether")),
          new BN(web3.utils.toWei("819.041838298384071100", "ether")),
          new BN(web3.utils.toWei("40966.270195910633159000", "ether")),
        ],
        startOfEpoch: new BN("1650758400"),
        midOfEpoch: new BN("1651700699"),
        endOfEpoch: new BN("1651968000"),
        midOfInterval: new BN("1652014275"),
        endOfInterval: new BN("1652054400"),
      },
      {
        depositAmounts: [
          new BN(web3.utils.toWei("736183124.550293854400912000", "ether")),
          new BN(web3.utils.toWei("10434.052679527224262600", "ether")),
          new BN(web3.utils.toWei("28548.615215973276283000", "ether")),
          new BN(web3.utils.toWei("49241.258168700008232000", "ether")),
          new BN(web3.utils.toWei("342557.181391865719700000", "ether")),
        ],
        startOfEpoch: new BN("1652054400"),
        midOfEpoch: new BN("1652102334"),
        endOfEpoch: new BN("1653264000"),
        midOfInterval: new BN("1653296243"),
        endOfInterval: new BN("1653350400"),
      },
      {
        depositAmounts: [
          new BN(web3.utils.toWei("2485056.307929841700919000", "ether")),
          new BN(web3.utils.toWei("99870687.000142212762012735", "ether")),
          new BN(web3.utils.toWei("363303284.000037513843611753", "ether")),
          new BN(web3.utils.toWei("3356790.000048978490993875", "ether")),
          new BN(web3.utils.toWei("2525005.000800850361079629", "ether")),
        ],
        startOfEpoch: new BN("1653350400"),
        midOfEpoch: new BN("1654152718"),
        endOfEpoch: new BN("1654560000"),
        midOfInterval: new BN("1654569429"),
        endOfInterval: new BN("1654646400"),
      },
    ];

    const expectZeroDsec = new BN("0");
    const expectFutureDsecBalance = new BN("0");

    let expectDsecBalances = [];
    for (let i = 0; i <= ExpectGovernanceForming.totalNumberOfEpochs; i++) {
      expectDsecBalances[i] = new BN("0");
    }

    for (let index = 0; index <= ExpectGovernanceForming.totalNumberOfEpochs; index++) {
      const testEpoch = index > 0 ? index - 1 : index;
      const expectCurrentEpochStartTimestamp =
        index > 0
          ? expectCurrentEpochTimestamps[index].startOfEpoch
          : expectCurrentEpochTimestamps[index + 1].startOfEpoch;
      const expectCurrentEpochEndTimestamp =
        index > 0 ? expectCurrentEpochTimestamps[index].endOfEpoch : expectCurrentEpochTimestamps[index + 1].endOfEpoch;

      await time.increaseTo(expectCurrentEpochTimestamps[index].startOfEpoch);
      let currentEpoch = await dsecDistribution.getCurrentEpoch();
      let currentEpochStartTimestamp = await dsecDistribution.getCurrentEpochStartTimestamp();
      let currentEpochEndTimestamp = await dsecDistribution.getCurrentEpochEndTimestamp();
      let epochAtTimestamp = await dsecDistribution.getEpoch(expectCurrentEpochTimestamps[index].startOfEpoch);
      let epochStartTimestamp = await dsecDistribution.getEpochStartTimestamp(
        expectCurrentEpochTimestamps[index].startOfEpoch
      );
      let epochEndTimestamp = await dsecDistribution.getEpochEndTimestamp(
        expectCurrentEpochTimestamps[index].startOfEpoch
      );
      let secondsUntilCurrentEpochEnd = await dsecDistribution.getSecondsUntilCurrentEpochEnd();
      let secondsEndBlockTimestamp = await time.latest();
      let secondsUntilEpochEnd = await dsecDistribution.getSecondsUntilEpochEnd(
        expectCurrentEpochTimestamps[index].startOfEpoch
      );
      let currentZeroDsec = await dsecDistribution.getDsecForTransferNow(new BN("0"));
      let currentDsec = await dsecDistribution.getDsecForTransferNow(
        expectCurrentEpochTimestamps[index].depositAmounts[0]
      );
      let dsecBlockTimestamp = await time.latest();
      let addDsec = await dsecDistribution.addDsec(accounts[9], expectCurrentEpochTimestamps[index].depositAmounts[0]);
      let addDsecBlockTimestamp = await testUtil.getBlockTimestamp(addDsec.receipt.blockHash);
      let dsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], testEpoch);
      let dsecBalanceBlockTimestamp = await time.latest();
      let futureDsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], testEpoch + 1);
      let calculateRewardFor = await dsecDistribution.calculateRewardFor(
        accounts[9],
        testEpoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let estimateRewardForCurrentEpoch = await dsecDistribution.estimateRewardForCurrentEpoch(
        accounts[9],
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      let hasRedeemedDsecBeforeRedeem = await dsecDistribution.hasRedeemedDsec(accounts[9], testEpoch);
      let redeemDsec = await dsecDistribution.redeemDsec(accounts[9], testEpoch, DISTRIBUTION_AMOUNT_PER_EPOCH);
      let hasRedeemedDsecAfterRedeem = await dsecDistribution.hasRedeemedDsec(accounts[9], testEpoch);
      let hasRedeemedTeamRewardBeforeRedeem = await dsecDistribution.hasRedeemedTeamReward(testEpoch);
      await expectRevert(dsecDistribution.redeemTeamReward(testEpoch), "only for completed epochs");
      let hasRedeemedTeamRewardAfterRedeem = await dsecDistribution.hasRedeemedTeamReward(testEpoch);
      let expectHasRedeemedDsecBeforeRedeem = false;
      let expectHasRedeemedDsecAfterRedeem = false;
      let expectHasRedeemedTeamRewardBeforeRedeem = false;
      let expectHasRedeemedTeamRewardAfterRedeem = false;
      let expectCalculateRewardFor = new BN("0");
      let expectEstimateRewardForCurrentEpoch = DISTRIBUTION_AMOUNT_PER_EPOCH;
      let expectSecondsUntilCurrentEpochEnd =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch.sub(secondsEndBlockTimestamp)
          : ExpectGovernanceForming.epochDuration;
      let expectSecondsUntilEpochEnd =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch.sub(expectCurrentEpochTimestamps[index].startOfEpoch)
          : ExpectGovernanceForming.epochDuration;
      let expectCurrentDsec =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch
              .sub(dsecBlockTimestamp)
              .mul(expectCurrentEpochTimestamps[index].depositAmounts[0])
          : ExpectGovernanceForming.epochDuration.mul(expectCurrentEpochTimestamps[index].depositAmounts[0]);
      let expectAddDsec =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch
              .sub(addDsecBlockTimestamp)
              .mul(expectCurrentEpochTimestamps[index].depositAmounts[0])
          : ExpectGovernanceForming.epochDuration.mul(expectCurrentEpochTimestamps[index].depositAmounts[0]);
      expectDsecBalances[testEpoch] = expectDsecBalances[testEpoch].add(expectAddDsec);
      if (index > 1) {
        for (let i = 0; i < index; i++) {
          for (let j = 0; j < NUMBER_OF_DEPOSITS_IN_EPOCH; j++) {
            expectDsecBalances[testEpoch] = expectDsecBalances[testEpoch].add(
              ExpectGovernanceForming.epochDuration.mul(expectCurrentEpochTimestamps[i].depositAmounts[j])
            );
          }
        }
      }
      expectEvent(addDsec, "DsecAdd", {
        account: accounts[9],
        epoch: new BN(testEpoch),
        amount: expectCurrentEpochTimestamps[index].depositAmounts[0],
        timestamp: addDsecBlockTimestamp,
        dsec: expectAddDsec,
      });
      expectEvent.notEmitted(redeemDsec, "DsecRedeem");
      assert.ok(
        currentEpoch.eq(new BN(testEpoch)),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Current epoch is ${currentEpoch} instead of ${testEpoch}`
      );
      assert.ok(
        currentEpochStartTimestamp[0].eq(new BN(testEpoch)),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Start epoch is ${currentEpochStartTimestamp[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentEpochStartTimestamp[1].eq(expectCurrentEpochStartTimestamp),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Start timestamp is ${currentEpochStartTimestamp[1]} instead of ${expectCurrentEpochStartTimestamp}`
      );
      assert.ok(
        currentEpochEndTimestamp[0].eq(new BN(testEpoch)),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): End epoch is ${currentEpochEndTimestamp[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentEpochEndTimestamp[1].eq(expectCurrentEpochEndTimestamp),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): End timestamp is ${currentEpochEndTimestamp[1]} instead of ${expectCurrentEpochEndTimestamp}`
      );
      assert.ok(
        epochAtTimestamp.eq(new BN(testEpoch)),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Epoch at timestamp is ${epochAtTimestamp} instead of ${testEpoch}`
      );
      assert.ok(
        epochStartTimestamp[0].eq(new BN(testEpoch)),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Epoch start is ${epochStartTimestamp[0]} instead of ${testEpoch}`
      );
      assert.ok(
        epochStartTimestamp[1].eq(expectCurrentEpochStartTimestamp),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Epoch start timestamp is ${epochStartTimestamp[1]} instead of ${expectCurrentEpochStartTimestamp}`
      );
      assert.ok(
        epochEndTimestamp[0].eq(new BN(testEpoch)),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Epoch end is ${epochEndTimestamp[0]} instead of ${testEpoch}`
      );
      assert.ok(
        epochEndTimestamp[1].eq(expectCurrentEpochEndTimestamp),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Epoch end timestamp is ${epochEndTimestamp[1]} instead of ${expectCurrentEpochEndTimestamp}`
      );
      assert.ok(
        secondsUntilCurrentEpochEnd[0].eq(new BN(testEpoch)),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Seconds current epoch is ${secondsUntilCurrentEpochEnd[0]} instead of ${testEpoch}`
      );
      assert.ok(
        secondsUntilCurrentEpochEnd[1].eq(expectSecondsUntilCurrentEpochEnd),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Seconds until current epoch end is ${secondsUntilCurrentEpochEnd[1]} instead of ${expectSecondsUntilCurrentEpochEnd}`
      );
      assert.ok(
        secondsUntilEpochEnd[0].eq(new BN(testEpoch)),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Seconds epoch is ${secondsUntilEpochEnd[0]} instead of ${testEpoch}`
      );
      assert.ok(
        secondsUntilEpochEnd[1].eq(expectSecondsUntilEpochEnd),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Seconds until epoch end is ${secondsUntilEpochEnd[1]} instead of ${expectSecondsUntilEpochEnd}`
      );
      assert.ok(
        currentZeroDsec[0].eq(new BN(testEpoch)),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): DSec(0) epoch is ${currentZeroDsec[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentZeroDsec[1].eq(expectZeroDsec),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): DSec(0) is ${currentZeroDsec[1]} instead of ${expectZeroDsec}`
      );
      assert.ok(
        currentDsec[0].eq(new BN(testEpoch)),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): DSec(${expectCurrentEpochTimestamps[index].depositAmounts[0]}) epoch is ${currentDsec[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentDsec[1].eq(expectCurrentDsec),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): DSec(${expectCurrentEpochTimestamps[index].depositAmounts[0]}) is ${currentDsec[1]} instead of ${expectCurrentDsec}`
      );
      assert.ok(
        dsecBalance.eq(expectDsecBalances[testEpoch]),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): DSec balance (${expectCurrentEpochTimestamps[index].depositAmounts[0]}, ${addDsecBlockTimestamp}, ${dsecBalanceBlockTimestamp}) is ${dsecBalance} instead of ${expectDsecBalances[testEpoch]}`
      );
      assert.ok(
        futureDsecBalance.eq(expectFutureDsecBalance),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): Future DSec balance (${expectCurrentEpochTimestamps[index].depositAmounts[0]}) is ${futureDsecBalance} instead of ${expectFutureDsecBalance}`
      );
      assert.ok(
        calculateRewardFor.eq(expectCalculateRewardFor),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): calculateRewardFor is ${calculateRewardFor} instead of ${expectCalculateRewardFor}`
      );
      assert.ok(
        estimateRewardForCurrentEpoch.eq(expectEstimateRewardForCurrentEpoch),
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): estimateRewardForCurrentEpoch is ${estimateRewardForCurrentEpoch} instead of ${expectEstimateRewardForCurrentEpoch}`
      );
      assert.strictEqual(
        hasRedeemedDsecBeforeRedeem,
        expectHasRedeemedDsecBeforeRedeem,
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): hasRedeemedDsec before redeem is ${hasRedeemedDsecBeforeRedeem} instead of ${expectHasRedeemedDsecBeforeRedeem}`
      );
      assert.strictEqual(
        hasRedeemedDsecAfterRedeem,
        expectHasRedeemedDsecAfterRedeem,
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): hasRedeemedDsec after redeem is ${hasRedeemedDsecAfterRedeem} instead of ${expectHasRedeemedDsecAfterRedeem}`
      );
      assert.strictEqual(
        hasRedeemedTeamRewardBeforeRedeem,
        expectHasRedeemedTeamRewardBeforeRedeem,
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): hasRedeemedTeamReward before redeem is ${hasRedeemedTeamRewardBeforeRedeem} instead of ${expectHasRedeemedTeamRewardBeforeRedeem}`
      );
      assert.strictEqual(
        hasRedeemedTeamRewardAfterRedeem,
        expectHasRedeemedTeamRewardAfterRedeem,
        `Index ${index} (Start Epoch Timestamp ${expectCurrentEpochTimestamps[index].startOfEpoch}): hasRedeemedTeamReward after redeem is ${hasRedeemedTeamRewardAfterRedeem} instead of ${expectHasRedeemedTeamRewardAfterRedeem}`
      );

      await time.increaseTo(expectCurrentEpochTimestamps[index].midOfEpoch);
      currentEpoch = await dsecDistribution.getCurrentEpoch();
      currentEpochStartTimestamp = await dsecDistribution.getCurrentEpochStartTimestamp();
      currentEpochEndTimestamp = await dsecDistribution.getCurrentEpochEndTimestamp();
      epochAtTimestamp = await dsecDistribution.getEpoch(expectCurrentEpochTimestamps[index].midOfEpoch);
      epochStartTimestamp = await dsecDistribution.getEpochStartTimestamp(
        expectCurrentEpochTimestamps[index].midOfEpoch
      );
      epochEndTimestamp = await dsecDistribution.getEpochEndTimestamp(expectCurrentEpochTimestamps[index].midOfEpoch);
      secondsUntilCurrentEpochEnd = await dsecDistribution.getSecondsUntilCurrentEpochEnd();
      secondsEndBlockTimestamp = await time.latest();
      secondsUntilEpochEnd = await dsecDistribution.getSecondsUntilEpochEnd(
        expectCurrentEpochTimestamps[index].midOfEpoch
      );
      currentZeroDsec = await dsecDistribution.getDsecForTransferNow(new BN("0"));
      currentDsec = await dsecDistribution.getDsecForTransferNow(expectCurrentEpochTimestamps[index].depositAmounts[1]);
      dsecBlockTimestamp = await time.latest();
      addDsec = await dsecDistribution.addDsec(accounts[9], expectCurrentEpochTimestamps[index].depositAmounts[1]);
      addDsecBlockTimestamp = await testUtil.getBlockTimestamp(addDsec.receipt.blockHash);
      dsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], testEpoch);
      dsecBalanceBlockTimestamp = await time.latest();
      futureDsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], testEpoch + 1);
      calculateRewardFor = await dsecDistribution.calculateRewardFor(
        accounts[9],
        testEpoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      estimateRewardForCurrentEpoch = await dsecDistribution.estimateRewardForCurrentEpoch(
        accounts[9],
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      hasRedeemedDsecBeforeRedeem = await dsecDistribution.hasRedeemedDsec(accounts[9], testEpoch);
      redeemDsec = await dsecDistribution.redeemDsec(accounts[9], testEpoch, DISTRIBUTION_AMOUNT_PER_EPOCH);
      hasRedeemedDsecAfterRedeem = await dsecDistribution.hasRedeemedDsec(accounts[9], testEpoch);
      hasRedeemedTeamRewardBeforeRedeem = await dsecDistribution.hasRedeemedTeamReward(testEpoch);
      await expectRevert(dsecDistribution.redeemTeamReward(testEpoch), "only for completed epochs");
      hasRedeemedTeamRewardAfterRedeem = await dsecDistribution.hasRedeemedTeamReward(testEpoch);
      expectHasRedeemedDsecBeforeRedeem = false;
      expectHasRedeemedDsecAfterRedeem = false;
      expectHasRedeemedTeamRewardBeforeRedeem = false;
      expectHasRedeemedTeamRewardAfterRedeem = false;
      expectCalculateRewardFor = new BN("0");
      expectEstimateRewardForCurrentEpoch = DISTRIBUTION_AMOUNT_PER_EPOCH;
      expectSecondsUntilCurrentEpochEnd =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch.sub(secondsEndBlockTimestamp)
          : ExpectGovernanceForming.epochDuration;
      expectSecondsUntilEpochEnd =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch.sub(expectCurrentEpochTimestamps[index].midOfEpoch)
          : ExpectGovernanceForming.epochDuration;
      expectCurrentDsec =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch
              .sub(dsecBlockTimestamp)
              .mul(expectCurrentEpochTimestamps[index].depositAmounts[1])
          : ExpectGovernanceForming.epochDuration.mul(expectCurrentEpochTimestamps[index].depositAmounts[1]);
      expectAddDsec =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch
              .sub(addDsecBlockTimestamp)
              .mul(expectCurrentEpochTimestamps[index].depositAmounts[1])
          : ExpectGovernanceForming.epochDuration.mul(expectCurrentEpochTimestamps[index].depositAmounts[1]);
      expectDsecBalances[testEpoch] = expectDsecBalances[testEpoch].add(expectAddDsec);
      expectEvent(addDsec, "DsecAdd", {
        account: accounts[9],
        epoch: new BN(testEpoch),
        amount: expectCurrentEpochTimestamps[index].depositAmounts[1],
        timestamp: addDsecBlockTimestamp,
        dsec: expectAddDsec,
      });
      expectEvent.notEmitted(redeemDsec, "DsecRedeem");
      assert.ok(
        currentEpoch.eq(new BN(testEpoch)),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Current epoch is ${currentEpoch} instead of ${testEpoch}`
      );
      assert.ok(
        currentEpochStartTimestamp[0].eq(new BN(testEpoch)),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Start epoch is ${currentEpochStartTimestamp[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentEpochStartTimestamp[1].eq(expectCurrentEpochStartTimestamp),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Start timestamp is ${currentEpochStartTimestamp[1]} instead of ${expectCurrentEpochStartTimestamp}`
      );
      assert.ok(
        currentEpochEndTimestamp[0].eq(new BN(testEpoch)),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): End epoch is ${currentEpochEndTimestamp[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentEpochEndTimestamp[1].eq(expectCurrentEpochEndTimestamp),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): End timestamp is ${currentEpochEndTimestamp[1]} instead of ${expectCurrentEpochEndTimestamp}`
      );
      assert.ok(
        epochAtTimestamp.eq(new BN(testEpoch)),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Epoch at timestamp is ${epochAtTimestamp} instead of ${testEpoch}`
      );
      assert.ok(
        epochStartTimestamp[0].eq(new BN(testEpoch)),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Epoch start is ${epochStartTimestamp[0]} instead of ${testEpoch}`
      );
      assert.ok(
        epochStartTimestamp[1].eq(expectCurrentEpochStartTimestamp),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Epoch start timestamp is ${epochStartTimestamp[1]} instead of ${expectCurrentEpochStartTimestamp}`
      );
      assert.ok(
        epochEndTimestamp[0].eq(new BN(testEpoch)),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Epoch end is ${epochEndTimestamp[0]} instead of ${testEpoch}`
      );
      assert.ok(
        epochEndTimestamp[1].eq(expectCurrentEpochEndTimestamp),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Epoch end timestamp is ${epochEndTimestamp[1]} instead of ${expectCurrentEpochEndTimestamp}`
      );
      assert.ok(
        secondsUntilCurrentEpochEnd[0].eq(new BN(testEpoch)),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Seconds current epoch is ${secondsUntilCurrentEpochEnd[0]} instead of ${testEpoch}`
      );
      assert.ok(
        secondsUntilCurrentEpochEnd[1].eq(expectSecondsUntilCurrentEpochEnd),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Seconds until current epoch end is ${secondsUntilCurrentEpochEnd[1]} instead of ${expectSecondsUntilCurrentEpochEnd}`
      );
      assert.ok(
        secondsUntilEpochEnd[0].eq(new BN(testEpoch)),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Seconds epoch is ${secondsUntilEpochEnd[0]} instead of ${testEpoch}`
      );
      assert.ok(
        secondsUntilEpochEnd[1].eq(expectSecondsUntilEpochEnd),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Seconds until epoch end is ${secondsUntilEpochEnd[1]} instead of ${expectSecondsUntilEpochEnd}`
      );
      assert.ok(
        currentZeroDsec[0].eq(new BN(testEpoch)),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): DSec(0) epoch is ${currentZeroDsec[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentZeroDsec[1].eq(expectZeroDsec),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): DSec(0) is ${currentZeroDsec[1]} instead of ${expectZeroDsec}`
      );
      assert.ok(
        currentDsec[0].eq(new BN(testEpoch)),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): DSec(${expectCurrentEpochTimestamps[index].depositAmounts[1]}) epoch is ${currentDsec[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentDsec[1].eq(expectCurrentDsec),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): DSec(${expectCurrentEpochTimestamps[index].depositAmounts[1]}) is ${currentDsec[1]} instead of ${expectCurrentDsec}`
      );
      assert.ok(
        dsecBalance.eq(expectDsecBalances[testEpoch]),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): DSec balance (${expectCurrentEpochTimestamps[index].depositAmounts[1]}, ${addDsecBlockTimestamp}, ${dsecBalanceBlockTimestamp}) is ${dsecBalance} instead of ${expectDsecBalances[testEpoch]}`
      );
      assert.ok(
        futureDsecBalance.eq(expectFutureDsecBalance),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): Future DSec balance (${expectCurrentEpochTimestamps[index].depositAmounts[1]}) is ${futureDsecBalance} instead of ${expectFutureDsecBalance}`
      );
      assert.ok(
        calculateRewardFor.eq(expectCalculateRewardFor),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): calculateRewardFor is ${calculateRewardFor} instead of ${expectCalculateRewardFor}`
      );
      assert.ok(
        estimateRewardForCurrentEpoch.eq(expectEstimateRewardForCurrentEpoch),
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): estimateRewardForCurrentEpoch is ${estimateRewardForCurrentEpoch} instead of ${expectEstimateRewardForCurrentEpoch}`
      );
      assert.strictEqual(
        hasRedeemedDsecBeforeRedeem,
        expectHasRedeemedDsecBeforeRedeem,
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): hasRedeemedDsec before redeem is ${hasRedeemedDsecBeforeRedeem} instead of ${expectHasRedeemedDsecBeforeRedeem}`
      );
      assert.strictEqual(
        hasRedeemedDsecAfterRedeem,
        expectHasRedeemedDsecAfterRedeem,
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): hasRedeemedDsec after redeem is ${hasRedeemedDsecAfterRedeem} instead of ${expectHasRedeemedDsecAfterRedeem}`
      );
      assert.strictEqual(
        hasRedeemedTeamRewardBeforeRedeem,
        expectHasRedeemedTeamRewardBeforeRedeem,
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): hasRedeemedTeamReward before redeem is ${hasRedeemedTeamRewardBeforeRedeem} instead of ${expectHasRedeemedTeamRewardBeforeRedeem}`
      );
      assert.strictEqual(
        hasRedeemedTeamRewardAfterRedeem,
        expectHasRedeemedTeamRewardAfterRedeem,
        `Index ${index} (Mid Epoch Timestamp ${expectCurrentEpochTimestamps[index].midOfEpoch}): hasRedeemedTeamReward after redeem is ${hasRedeemedTeamRewardAfterRedeem} instead of ${expectHasRedeemedTeamRewardAfterRedeem}`
      );

      const expectEpoch =
        index > 0
          ? ExpectGovernanceForming.totalNumberOfEpochs.sub(new BN("1")).gt(new BN(testEpoch))
            ? new BN(testEpoch + 1)
            : ExpectGovernanceForming.totalNumberOfEpochs
          : new BN(testEpoch);
      const expectEpochStartTimestamp = ExpectGovernanceForming.totalNumberOfEpochs
        .sub(new BN("1"))
        .gt(new BN(testEpoch))
        ? expectCurrentEpochTimestamps[index + 1].startOfEpoch
        : new BN("0");
      const expectEpochEndTimestamp = ExpectGovernanceForming.totalNumberOfEpochs.sub(new BN("1")).gt(new BN(testEpoch))
        ? expectCurrentEpochTimestamps[index + 1].endOfEpoch
        : new BN("0");
      const expectSecondsToEpochEnd = ExpectGovernanceForming.totalNumberOfEpochs.sub(new BN("1")).gt(new BN(testEpoch))
        ? ExpectGovernanceForming.epochDuration
        : new BN("0");

      await time.increaseTo(expectCurrentEpochTimestamps[index].endOfEpoch.sub(new BN(EPOCH_END_LEAD_TIME_SECS)));
      currentEpoch = await dsecDistribution.getCurrentEpoch();
      currentEpochStartTimestamp = await dsecDistribution.getCurrentEpochStartTimestamp();
      currentEpochEndTimestamp = await dsecDistribution.getCurrentEpochEndTimestamp();
      epochAtTimestamp = await dsecDistribution.getEpoch(expectCurrentEpochTimestamps[index].endOfEpoch);
      epochStartTimestamp = await dsecDistribution.getEpochStartTimestamp(
        expectCurrentEpochTimestamps[index].endOfEpoch
      );
      epochEndTimestamp = await dsecDistribution.getEpochEndTimestamp(expectCurrentEpochTimestamps[index].endOfEpoch);
      secondsUntilCurrentEpochEnd = await dsecDistribution.getSecondsUntilCurrentEpochEnd();
      secondsUntilEpochEnd = await dsecDistribution.getSecondsUntilEpochEnd(
        expectCurrentEpochTimestamps[index].endOfEpoch
      );
      secondsEndBlockTimestamp = await time.latest();
      currentZeroDsec = await dsecDistribution.getDsecForTransferNow(new BN("0"));
      currentDsec = await dsecDistribution.getDsecForTransferNow(expectCurrentEpochTimestamps[index].depositAmounts[2]);
      dsecBlockTimestamp = await time.latest();
      addDsec = await dsecDistribution.addDsec(accounts[9], expectCurrentEpochTimestamps[index].depositAmounts[2]);
      addDsecBlockTimestamp = await testUtil.getBlockTimestamp(addDsec.receipt.blockHash);
      dsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], testEpoch);
      dsecBalanceBlockTimestamp = await time.latest();
      futureDsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], testEpoch + 1);
      calculateRewardFor = await dsecDistribution.calculateRewardFor(
        accounts[9],
        testEpoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      estimateRewardForCurrentEpoch = await dsecDistribution.estimateRewardForCurrentEpoch(
        accounts[9],
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      hasRedeemedDsecBeforeRedeem = await dsecDistribution.hasRedeemedDsec(accounts[9], testEpoch);
      redeemDsec = await dsecDistribution.redeemDsec(accounts[9], testEpoch, DISTRIBUTION_AMOUNT_PER_EPOCH);
      hasRedeemedDsecAfterRedeem = await dsecDistribution.hasRedeemedDsec(accounts[9], testEpoch);
      hasRedeemedTeamRewardBeforeRedeem = await dsecDistribution.hasRedeemedTeamReward(testEpoch);
      await expectRevert(dsecDistribution.redeemTeamReward(testEpoch), "only for completed epochs");
      hasRedeemedTeamRewardAfterRedeem = await dsecDistribution.hasRedeemedTeamReward(testEpoch);
      expectHasRedeemedDsecBeforeRedeem = false;
      expectHasRedeemedDsecAfterRedeem = false;
      expectHasRedeemedTeamRewardBeforeRedeem = false;
      expectHasRedeemedTeamRewardAfterRedeem = false;
      expectCalculateRewardFor = new BN("0");
      expectEstimateRewardForCurrentEpoch = DISTRIBUTION_AMOUNT_PER_EPOCH;
      expectSecondsUntilCurrentEpochEnd =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch.sub(secondsEndBlockTimestamp)
          : ExpectGovernanceForming.epochDuration;
      expectCurrentDsec =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch
              .sub(dsecBlockTimestamp)
              .mul(expectCurrentEpochTimestamps[index].depositAmounts[2])
          : ExpectGovernanceForming.epochDuration.mul(expectCurrentEpochTimestamps[index].depositAmounts[2]);
      expectAddDsec =
        index > 0
          ? expectCurrentEpochTimestamps[index].endOfEpoch
              .sub(addDsecBlockTimestamp)
              .mul(expectCurrentEpochTimestamps[index].depositAmounts[2])
          : ExpectGovernanceForming.epochDuration.mul(expectCurrentEpochTimestamps[index].depositAmounts[2]);
      expectDsecBalances[testEpoch] = expectDsecBalances[testEpoch].add(expectAddDsec);
      expectEvent(addDsec, "DsecAdd", {
        account: accounts[9],
        epoch: new BN(testEpoch),
        amount: expectCurrentEpochTimestamps[index].depositAmounts[2],
        timestamp: addDsecBlockTimestamp,
        dsec: expectAddDsec,
      });
      expectEvent.notEmitted(redeemDsec, "DsecRedeem");
      assert.ok(
        currentEpoch.eq(new BN(testEpoch)),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Current epoch is ${currentEpoch} instead of ${testEpoch}`
      );
      assert.ok(
        currentEpochStartTimestamp[0].eq(new BN(testEpoch)),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Start epoch is ${currentEpochStartTimestamp[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentEpochStartTimestamp[1].eq(expectCurrentEpochStartTimestamp),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Start timestamp is ${currentEpochStartTimestamp[1]} instead of ${expectCurrentEpochStartTimestamp}`
      );
      assert.ok(
        currentEpochEndTimestamp[0].eq(new BN(testEpoch)),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): End epoch is ${currentEpochEndTimestamp[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentEpochEndTimestamp[1].eq(expectCurrentEpochEndTimestamp),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): End timestamp is ${currentEpochEndTimestamp[1]} instead of ${expectCurrentEpochEndTimestamp}`
      );
      assert.ok(
        epochAtTimestamp.eq(expectEpoch),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Epoch at timestamp is ${epochAtTimestamp} instead of ${expectEpoch}`
      );
      assert.ok(
        epochStartTimestamp[0].eq(expectEpoch),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Epoch start is ${epochStartTimestamp[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        epochStartTimestamp[1].eq(expectEpochStartTimestamp),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Epoch start timestamp is ${epochStartTimestamp[1]} instead of ${expectEpochStartTimestamp}`
      );
      assert.ok(
        epochEndTimestamp[0].eq(expectEpoch),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Epoch end is ${epochEndTimestamp[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        epochEndTimestamp[1].eq(expectEpochEndTimestamp),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Epoch end timestamp is ${epochEndTimestamp[1]} instead of ${expectEpochEndTimestamp}`
      );
      assert.ok(
        secondsUntilCurrentEpochEnd[0].eq(new BN(testEpoch)),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Seconds current epoch is ${secondsUntilCurrentEpochEnd[0]} instead of ${testEpoch}`
      );
      assert.ok(
        secondsUntilCurrentEpochEnd[1].eq(expectSecondsUntilCurrentEpochEnd),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Seconds until current epoch end is ${secondsUntilCurrentEpochEnd[1]} instead of ${expectSecondsUntilCurrentEpochEnd}`
      );
      assert.ok(
        secondsUntilEpochEnd[0].eq(expectEpoch),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Seconds epoch is ${secondsUntilEpochEnd[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        secondsUntilEpochEnd[1].eq(expectSecondsToEpochEnd),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Seconds until epoch end is ${secondsUntilEpochEnd[1]} instead of ${expectSecondsToEpochEnd}`
      );
      assert.ok(
        currentZeroDsec[0].eq(new BN(testEpoch)),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): DSec(0) epoch is ${currentZeroDsec[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentZeroDsec[1].eq(expectZeroDsec),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): DSec(0) is ${currentZeroDsec[1]} instead of ${expectZeroDsec}`
      );
      assert.ok(
        currentDsec[0].eq(new BN(testEpoch)),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): DSec(${expectCurrentEpochTimestamps[index].depositAmounts[2]}) epoch is ${currentDsec[0]} instead of ${testEpoch}`
      );
      assert.ok(
        currentDsec[1].eq(expectCurrentDsec),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): DSec(${expectCurrentEpochTimestamps[index].depositAmounts[2]}) is ${currentDsec[1]} instead of ${expectCurrentDsec}`
      );
      assert.ok(
        dsecBalance.eq(expectDsecBalances[testEpoch]),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): DSec balance (${expectCurrentEpochTimestamps[index].depositAmounts[2]}, ${addDsecBlockTimestamp}, ${dsecBalanceBlockTimestamp}) is ${dsecBalance} instead of ${expectDsecBalances[testEpoch]}`
      );
      assert.ok(
        futureDsecBalance.eq(expectFutureDsecBalance),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): Future DSec balance (${expectCurrentEpochTimestamps[index].depositAmounts[2]}) is ${futureDsecBalance} instead of ${expectFutureDsecBalance}`
      );
      assert.ok(
        calculateRewardFor.eq(expectCalculateRewardFor),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): calculateRewardFor is ${calculateRewardFor} instead of ${expectCalculateRewardFor}`
      );
      assert.ok(
        estimateRewardForCurrentEpoch.eq(expectEstimateRewardForCurrentEpoch),
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): estimateRewardForCurrentEpoch is ${estimateRewardForCurrentEpoch} instead of ${expectEstimateRewardForCurrentEpoch}`
      );
      assert.strictEqual(
        hasRedeemedDsecBeforeRedeem,
        expectHasRedeemedDsecBeforeRedeem,
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): hasRedeemedDsec before redeem is ${hasRedeemedDsecBeforeRedeem} instead of ${expectHasRedeemedDsecBeforeRedeem}`
      );
      assert.strictEqual(
        hasRedeemedDsecAfterRedeem,
        expectHasRedeemedDsecAfterRedeem,
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): hasRedeemedDsec after redeem is ${hasRedeemedDsecAfterRedeem} instead of ${expectHasRedeemedDsecAfterRedeem}`
      );
      assert.strictEqual(
        hasRedeemedTeamRewardBeforeRedeem,
        expectHasRedeemedTeamRewardBeforeRedeem,
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): hasRedeemedTeamReward before redeem is ${hasRedeemedTeamRewardBeforeRedeem} instead of ${expectHasRedeemedTeamRewardBeforeRedeem}`
      );
      assert.strictEqual(
        hasRedeemedTeamRewardAfterRedeem,
        expectHasRedeemedTeamRewardAfterRedeem,
        `Index ${index} (End Epoch Timestamp ${expectCurrentEpochTimestamps[index].endOfEpoch}): hasRedeemedTeamReward after redeem is ${hasRedeemedTeamRewardAfterRedeem} instead of ${expectHasRedeemedTeamRewardAfterRedeem}`
      );

      const expectDsecMidInterval = ExpectGovernanceForming.totalNumberOfEpochs.sub(new BN("1")).gt(new BN(testEpoch))
        ? ExpectGovernanceForming.epochDuration.mul(expectCurrentEpochTimestamps[index].depositAmounts[3])
        : new BN("0");

      await time.increaseTo(expectCurrentEpochTimestamps[index].midOfInterval);
      currentEpoch = await dsecDistribution.getCurrentEpoch();
      currentEpochStartTimestamp = await dsecDistribution.getCurrentEpochStartTimestamp();
      currentEpochEndTimestamp = await dsecDistribution.getCurrentEpochEndTimestamp();
      epochAtTimestamp = await dsecDistribution.getEpoch(expectCurrentEpochTimestamps[index].midOfInterval);
      epochStartTimestamp = await dsecDistribution.getEpochStartTimestamp(
        expectCurrentEpochTimestamps[index].midOfInterval
      );
      epochEndTimestamp = await dsecDistribution.getEpochEndTimestamp(
        expectCurrentEpochTimestamps[index].midOfInterval
      );
      secondsUntilCurrentEpochEnd = await dsecDistribution.getSecondsUntilCurrentEpochEnd();
      secondsUntilEpochEnd = await dsecDistribution.getSecondsUntilEpochEnd(
        expectCurrentEpochTimestamps[index].midOfInterval
      );
      currentZeroDsec = await dsecDistribution.getDsecForTransferNow(new BN("0"));
      currentDsec = await dsecDistribution.getDsecForTransferNow(expectCurrentEpochTimestamps[index].depositAmounts[3]);
      addDsec = await dsecDistribution.addDsec(accounts[9], expectCurrentEpochTimestamps[index].depositAmounts[3]);
      addDsecBlockTimestamp = await testUtil.getBlockTimestamp(addDsec.receipt.blockHash);
      dsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], testEpoch);
      dsecBalanceBlockTimestamp = await time.latest();
      futureDsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], testEpoch + 2);
      calculateRewardFor = await dsecDistribution.calculateRewardFor(
        accounts[9],
        testEpoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      estimateRewardForCurrentEpoch = await dsecDistribution.estimateRewardForCurrentEpoch(
        accounts[9],
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      hasRedeemedDsecBeforeRedeem = await dsecDistribution.hasRedeemedDsec(accounts[9], testEpoch);
      redeemDsec = await dsecDistribution.redeemDsec(accounts[9], testEpoch, DISTRIBUTION_AMOUNT_PER_EPOCH);
      hasRedeemedDsecAfterRedeem = await dsecDistribution.hasRedeemedDsec(accounts[9], testEpoch);
      hasRedeemedTeamRewardBeforeRedeem = await dsecDistribution.hasRedeemedTeamReward(testEpoch);
      if (index > 0) {
        redeemTeamReward = await dsecDistribution.redeemTeamReward(testEpoch);
        expectEvent(redeemTeamReward, "TeamRewardRedeem", { sender: accounts[0], epoch: new BN(testEpoch) });
      } else {
        await expectRevert(dsecDistribution.redeemTeamReward(testEpoch), "only for completed epochs");
      }
      hasRedeemedTeamRewardAfterRedeem = await dsecDistribution.hasRedeemedTeamReward(testEpoch);
      expectHasRedeemedDsecBeforeRedeem = false;
      expectHasRedeemedDsecAfterRedeem = index > 0 ? true : false;
      expectHasRedeemedTeamRewardBeforeRedeem = false;
      expectHasRedeemedTeamRewardAfterRedeem = index > 0 ? true : false;
      expectRewardAmount = DISTRIBUTION_AMOUNT_PER_EPOCH;
      if (index > 0) {
        expectCalculateRewardFor = expectRewardAmount;
      } else {
        expectCalculateRewardFor = new BN("0");
      }
      expectEstimateRewardForCurrentEpoch = ExpectGovernanceForming.totalNumberOfEpochs
        .sub(new BN("1"))
        .gt(new BN(testEpoch))
        ? DISTRIBUTION_AMOUNT_PER_EPOCH
        : new BN("0");
      if (index == 0) {
        expectAddDsec = ExpectGovernanceForming.epochDuration.mul(
          expectCurrentEpochTimestamps[index].depositAmounts[3]
        );
        expectDsecBalances[testEpoch] = expectDsecBalances[testEpoch].add(expectAddDsec);
      }
      if (ExpectGovernanceForming.totalNumberOfEpochs.sub(new BN("1")).gt(new BN(testEpoch))) {
        expectEvent(addDsec, "DsecAdd", {
          account: accounts[9],
          epoch: expectEpoch,
          amount: expectCurrentEpochTimestamps[index].depositAmounts[3],
          timestamp: addDsecBlockTimestamp,
          dsec: expectDsecMidInterval,
        });
      } else {
        expectEvent.notEmitted(addDsec, "DsecAdd");
      }
      if (index > 0) {
        expectEvent(redeemDsec, "DsecRedeem", {
          account: accounts[9],
          epoch: new BN(testEpoch),
          distributionAmount: DISTRIBUTION_AMOUNT_PER_EPOCH,
          rewardAmount: expectRewardAmount,
        });
      } else {
        expectEvent.notEmitted(redeemDsec, "DsecRedeem");
      }
      assert.ok(
        currentEpoch.eq(expectEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Current epoch is ${currentEpoch} instead of ${expectEpoch}`
      );
      assert.ok(
        currentEpochStartTimestamp[0].eq(expectEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Start epoch is ${currentEpochStartTimestamp[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        currentEpochStartTimestamp[1].eq(expectEpochStartTimestamp),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Start timestamp is ${currentEpochStartTimestamp[1]} instead of ${expectEpochStartTimestamp}`
      );
      assert.ok(
        currentEpochEndTimestamp[0].eq(expectEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): End epoch is ${currentEpochEndTimestamp[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        currentEpochEndTimestamp[1].eq(expectEpochEndTimestamp),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): End timestamp is ${currentEpochEndTimestamp[1]} instead of ${expectEpochEndTimestamp}`
      );
      assert.ok(
        epochAtTimestamp.eq(expectEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Epoch at timestamp is ${epochAtTimestamp} instead of ${expectEpoch}`
      );
      assert.ok(
        epochStartTimestamp[0].eq(expectEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Epoch start is ${epochStartTimestamp[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        epochStartTimestamp[1].eq(expectEpochStartTimestamp),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Epoch start timestamp is ${epochStartTimestamp[1]} instead of ${expectEpochStartTimestamp}`
      );
      assert.ok(
        epochEndTimestamp[0].eq(expectEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Epoch end is ${epochEndTimestamp[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        epochEndTimestamp[1].eq(expectEpochEndTimestamp),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Epoch end timestamp is ${epochEndTimestamp[1]} instead of ${expectEpochEndTimestamp}`
      );
      assert.ok(
        secondsUntilCurrentEpochEnd[0].eq(expectEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Seconds current epoch is ${secondsUntilCurrentEpochEnd[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        secondsUntilCurrentEpochEnd[1].eq(expectSecondsToEpochEnd),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Seconds until current epoch end is ${secondsUntilCurrentEpochEnd[1]} instead of ${expectSecondsToEpochEnd}`
      );
      assert.ok(
        secondsUntilEpochEnd[0].eq(expectEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Seconds epoch is ${secondsUntilEpochEnd[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        secondsUntilEpochEnd[1].eq(expectSecondsToEpochEnd),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Seconds until epoch end is ${secondsUntilEpochEnd[1]} instead of ${expectSecondsToEpochEnd}`
      );
      assert.ok(
        currentZeroDsec[0].eq(expectEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): DSec(0) epoch is ${currentZeroDsec[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        currentZeroDsec[1].eq(expectZeroDsec),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): DSec(0) is ${currentZeroDsec[1]} instead of ${expectZeroDsec}`
      );
      assert.ok(
        currentDsec[0].eq(expectEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): DSec(${expectCurrentEpochTimestamps[index].depositAmounts[3]}) epoch is ${currentDsec[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        currentDsec[1].eq(expectDsecMidInterval),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): DSec(${expectCurrentEpochTimestamps[index].depositAmounts[3]}) is ${currentDsec[1]} instead of ${expectDsecMidInterval}`
      );
      assert.ok(
        dsecBalance.eq(expectDsecBalances[testEpoch]),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): DSec balance (${expectCurrentEpochTimestamps[index].depositAmounts[3]}, ${addDsecBlockTimestamp}, ${dsecBalanceBlockTimestamp}) is ${dsecBalance} instead of ${expectDsecBalances[testEpoch]}`
      );
      assert.ok(
        futureDsecBalance.eq(expectFutureDsecBalance),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): Future DSec balance (${expectCurrentEpochTimestamps[index].depositAmounts[3]}) is ${futureDsecBalance} instead of ${expectFutureDsecBalance}`
      );
      assert.ok(
        calculateRewardFor.eq(expectCalculateRewardFor),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): calculateRewardFor is ${calculateRewardFor} instead of ${expectCalculateRewardFor}`
      );
      assert.ok(
        estimateRewardForCurrentEpoch.eq(expectEstimateRewardForCurrentEpoch),
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): estimateRewardForCurrentEpoch is ${estimateRewardForCurrentEpoch} instead of ${expectEstimateRewardForCurrentEpoch}`
      );
      assert.strictEqual(
        hasRedeemedDsecBeforeRedeem,
        expectHasRedeemedDsecBeforeRedeem,
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): hasRedeemedDsec before redeem is ${hasRedeemedDsecBeforeRedeem} instead of ${expectHasRedeemedDsecBeforeRedeem}`
      );
      assert.strictEqual(
        hasRedeemedDsecAfterRedeem,
        expectHasRedeemedDsecAfterRedeem,
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): hasRedeemedDsec after redeem is ${hasRedeemedDsecAfterRedeem} instead of ${expectHasRedeemedDsecAfterRedeem}`
      );
      assert.strictEqual(
        hasRedeemedTeamRewardBeforeRedeem,
        expectHasRedeemedTeamRewardBeforeRedeem,
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): hasRedeemedTeamReward before redeem is ${hasRedeemedTeamRewardBeforeRedeem} instead of ${expectHasRedeemedTeamRewardBeforeRedeem}`
      );
      assert.strictEqual(
        hasRedeemedTeamRewardAfterRedeem,
        expectHasRedeemedTeamRewardAfterRedeem,
        `Index ${index} (Mid Interval Timestamp ${expectCurrentEpochTimestamps[index].midOfInterval}): hasRedeemedTeamReward after redeem is ${hasRedeemedTeamRewardAfterRedeem} instead of ${expectHasRedeemedTeamRewardAfterRedeem}`
      );

      const expectDsecEndInterval = ExpectGovernanceForming.totalNumberOfEpochs.sub(new BN("1")).gt(new BN(testEpoch))
        ? ExpectGovernanceForming.epochDuration.mul(expectCurrentEpochTimestamps[index].depositAmounts[4])
        : new BN("0");

      await time.increaseTo(expectCurrentEpochTimestamps[index].endOfInterval.sub(new BN(INTERVAL_END_LEAD_TIME_SECS)));
      currentEpoch = await dsecDistribution.getCurrentEpoch();
      currentEpochStartTimestamp = await dsecDistribution.getCurrentEpochStartTimestamp();
      currentEpochEndTimestamp = await dsecDistribution.getCurrentEpochEndTimestamp();
      epochAtTimestamp = await dsecDistribution.getEpoch(expectCurrentEpochTimestamps[index].endOfInterval);
      epochStartTimestamp = await dsecDistribution.getEpochStartTimestamp(
        expectCurrentEpochTimestamps[index].endOfInterval
      );
      epochEndTimestamp = await dsecDistribution.getEpochEndTimestamp(
        expectCurrentEpochTimestamps[index].endOfInterval
      );
      secondsUntilCurrentEpochEnd = await dsecDistribution.getSecondsUntilCurrentEpochEnd();
      secondsUntilEpochEnd = await dsecDistribution.getSecondsUntilEpochEnd(
        expectCurrentEpochTimestamps[index].endOfInterval
      );
      currentZeroDsec = await dsecDistribution.getDsecForTransferNow(new BN("0"));
      currentDsec = await dsecDistribution.getDsecForTransferNow(expectCurrentEpochTimestamps[index].depositAmounts[4]);
      addDsec = await dsecDistribution.addDsec(accounts[9], expectCurrentEpochTimestamps[index].depositAmounts[4]);
      addDsecBlockTimestamp = await testUtil.getBlockTimestamp(addDsec.receipt.blockHash);
      dsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], testEpoch);
      dsecBalanceBlockTimestamp = await time.latest();
      futureDsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], testEpoch + 2);
      calculateRewardFor = await dsecDistribution.calculateRewardFor(
        accounts[9],
        testEpoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      estimateRewardForCurrentEpoch = await dsecDistribution.estimateRewardForCurrentEpoch(
        accounts[9],
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      hasRedeemedDsecBeforeRedeem = await dsecDistribution.hasRedeemedDsec(accounts[9], testEpoch);
      redeemDsec = await dsecDistribution.redeemDsec(accounts[9], testEpoch, DISTRIBUTION_AMOUNT_PER_EPOCH);
      hasRedeemedDsecAfterRedeem = await dsecDistribution.hasRedeemedDsec(accounts[9], testEpoch);
      hasRedeemedTeamRewardBeforeRedeem = await dsecDistribution.hasRedeemedTeamReward(testEpoch);
      if (index == 0) {
        await expectRevert(dsecDistribution.redeemTeamReward(testEpoch), "only for completed epochs");
      } else {
        await expectRevert(dsecDistribution.redeemTeamReward(testEpoch), "already redeemed");
      }
      hasRedeemedTeamRewardAfterRedeem = await dsecDistribution.hasRedeemedTeamReward(testEpoch);
      expectHasRedeemedDsecBeforeRedeem = index > 0 ? true : false;
      expectHasRedeemedDsecAfterRedeem = index > 0 ? true : false;
      expectHasRedeemedTeamRewardBeforeRedeem = index > 0 ? true : false;
      expectHasRedeemedTeamRewardAfterRedeem = index > 0 ? true : false;
      expectRewardAmount = DISTRIBUTION_AMOUNT_PER_EPOCH;
      if (index > 0) {
        expectCalculateRewardFor = expectRewardAmount;
      } else {
        expectCalculateRewardFor = new BN("0");
      }
      expectEstimateRewardForCurrentEpoch = ExpectGovernanceForming.totalNumberOfEpochs
        .sub(new BN("1"))
        .gt(new BN(testEpoch))
        ? DISTRIBUTION_AMOUNT_PER_EPOCH
        : new BN("0");
      if (index == 0) {
        expectAddDsec = ExpectGovernanceForming.epochDuration.mul(
          expectCurrentEpochTimestamps[index].depositAmounts[4]
        );
        expectDsecBalances[testEpoch] = expectDsecBalances[testEpoch].add(expectAddDsec);
      }
      if (ExpectGovernanceForming.totalNumberOfEpochs.sub(new BN("1")).gt(new BN(testEpoch))) {
        expectEvent(addDsec, "DsecAdd", {
          account: accounts[9],
          epoch: expectEpoch,
          amount: expectCurrentEpochTimestamps[index].depositAmounts[4],
          timestamp: addDsecBlockTimestamp,
          dsec: expectDsecEndInterval,
        });
      } else {
        expectEvent.notEmitted(addDsec, "DsecAdd");
      }
      expectEvent.notEmitted(redeemDsec, "DsecRedeem");
      assert.ok(
        currentEpoch.eq(expectEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Current epoch is ${currentEpoch} instead of ${expectEpoch}`
      );
      assert.ok(
        currentEpochStartTimestamp[0].eq(expectEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Start epoch is ${currentEpochStartTimestamp[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        currentEpochStartTimestamp[1].eq(expectEpochStartTimestamp),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Start timestamp is ${currentEpochStartTimestamp[1]} instead of ${expectEpochStartTimestamp}`
      );
      assert.ok(
        currentEpochEndTimestamp[0].eq(expectEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): End epoch is ${currentEpochEndTimestamp[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        currentEpochEndTimestamp[1].eq(expectEpochEndTimestamp),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): End timestamp is ${currentEpochEndTimestamp[1]} instead of ${expectEpochEndTimestamp}`
      );
      assert.ok(
        epochAtTimestamp.eq(expectEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Epoch at timestamp is ${epochAtTimestamp} instead of ${expectEpoch}`
      );
      assert.ok(
        epochStartTimestamp[0].eq(expectEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Epoch start is ${epochStartTimestamp[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        epochStartTimestamp[1].eq(expectEpochStartTimestamp),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Epoch start timestamp is ${epochStartTimestamp[1]} instead of ${expectEpochStartTimestamp}`
      );
      assert.ok(
        epochEndTimestamp[0].eq(expectEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Epoch end is ${epochEndTimestamp[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        epochEndTimestamp[1].eq(expectEpochEndTimestamp),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Epoch end timestamp is ${epochEndTimestamp[1]} instead of ${expectEpochEndTimestamp}`
      );
      assert.ok(
        secondsUntilCurrentEpochEnd[0].eq(expectEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Seconds current epoch is ${secondsUntilCurrentEpochEnd[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        secondsUntilCurrentEpochEnd[1].eq(expectSecondsToEpochEnd),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Seconds until current epoch end is ${secondsUntilCurrentEpochEnd[1]} instead of ${expectSecondsToEpochEnd}`
      );
      assert.ok(
        secondsUntilEpochEnd[0].eq(expectEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Seconds epoch is ${secondsUntilEpochEnd[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        secondsUntilEpochEnd[1].eq(expectSecondsToEpochEnd),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Seconds until epoch end is ${secondsUntilEpochEnd[1]} instead of ${expectSecondsToEpochEnd}`
      );
      assert.ok(
        currentZeroDsec[0].eq(expectEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): DSec(0) epoch is ${currentZeroDsec[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        currentZeroDsec[1].eq(expectZeroDsec),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): DSec(0) is ${currentZeroDsec[1]} instead of ${expectZeroDsec}`
      );
      assert.ok(
        currentDsec[0].eq(expectEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): DSec(${expectCurrentEpochTimestamps[index].depositAmounts[4]}) epoch is ${currentDsec[0]} instead of ${expectEpoch}`
      );
      assert.ok(
        currentDsec[1].eq(expectDsecEndInterval),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): DSec(${expectCurrentEpochTimestamps[index].depositAmounts[4]}) is ${currentDsec[1]} instead of ${expectDsecEndInterval}`
      );
      assert.ok(
        dsecBalance.eq(expectDsecBalances[testEpoch]),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): DSec balance (${expectCurrentEpochTimestamps[index].depositAmounts[4]}, ${addDsecBlockTimestamp}, ${dsecBalanceBlockTimestamp}) is ${dsecBalance} instead of ${expectDsecBalances[testEpoch]}`
      );
      assert.ok(
        futureDsecBalance.eq(expectFutureDsecBalance),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): Future DSec balance (${expectCurrentEpochTimestamps[index].depositAmounts[4]}) is ${futureDsecBalance} instead of ${expectFutureDsecBalance}`
      );
      assert.ok(
        calculateRewardFor.eq(expectCalculateRewardFor),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): calculateRewardFor is ${calculateRewardFor} instead of ${expectCalculateRewardFor}`
      );
      assert.ok(
        estimateRewardForCurrentEpoch.eq(expectEstimateRewardForCurrentEpoch),
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): estimateRewardForCurrentEpoch is ${estimateRewardForCurrentEpoch} instead of ${expectEstimateRewardForCurrentEpoch}`
      );
      assert.strictEqual(
        hasRedeemedDsecBeforeRedeem,
        expectHasRedeemedDsecBeforeRedeem,
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): hasRedeemedDsec before redeem is ${hasRedeemedDsecBeforeRedeem} instead of ${expectHasRedeemedDsecBeforeRedeem}`
      );
      assert.strictEqual(
        hasRedeemedDsecAfterRedeem,
        expectHasRedeemedDsecAfterRedeem,
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): hasRedeemedDsec after redeem is ${hasRedeemedDsecAfterRedeem} instead of ${expectHasRedeemedDsecAfterRedeem}`
      );
      assert.strictEqual(
        hasRedeemedTeamRewardBeforeRedeem,
        expectHasRedeemedTeamRewardBeforeRedeem,
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): hasRedeemedTeamReward before redeem is ${hasRedeemedTeamRewardBeforeRedeem} instead of ${expectHasRedeemedTeamRewardBeforeRedeem}`
      );
      assert.strictEqual(
        hasRedeemedTeamRewardAfterRedeem,
        expectHasRedeemedTeamRewardAfterRedeem,
        `Index ${index} (End Interval Timestamp ${expectCurrentEpochTimestamps[index].endOfInterval}): hasRedeemedTeamReward after redeem is ${hasRedeemedTeamRewardAfterRedeem} instead of ${expectHasRedeemedTeamRewardAfterRedeem}`
      );
    }

    for (let epoch = 0; epoch <= ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      let dsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], epoch);
      assert.ok(
        dsecBalance.eq(expectDsecBalances[epoch]),
        `Epoch ${epoch}: DSec balance is ${dsecBalance} instead of ${expectDsecBalances[epoch]}`
      );
    }
  });

  it("should return correct values after governance forming ended", async () => {
    let timeIncreaseTo = ExpectGovernanceForming.endTimestamp.add(ExpectGovernanceForming.intervalBetweenEpochs);
    await time.increaseTo(timeIncreaseTo);

    const depositAmount = new BN(web3.utils.toWei("4833718947.307929841700919000", "ether"));

    const expectCurrentEpoch = new BN(ExpectGovernanceForming.totalNumberOfEpochs);
    const expectCurrentEpochStartTimestamp = new BN("0");
    const expectCurrentEpochEndTimestamp = new BN("0");
    const expectSecondsUntilCurrentEpochEnd = new BN("0");
    const expectCurrentDsec = new BN("0");
    const expectDsecBalance = new BN("0");

    let currentEpoch = await dsecDistribution.getCurrentEpoch();
    let currentEpochStartTimestamp = await dsecDistribution.getCurrentEpochStartTimestamp();
    let currentEpochEndTimestamp = await dsecDistribution.getCurrentEpochEndTimestamp();
    let epochAtTimestamp = await dsecDistribution.getEpoch(timeIncreaseTo);
    let epochStartTimestamp = await dsecDistribution.getEpochStartTimestamp(timeIncreaseTo);
    let epochEndTimestamp = await dsecDistribution.getEpochEndTimestamp(timeIncreaseTo);
    let secondsUntilCurrentEpochEnd = await dsecDistribution.getSecondsUntilCurrentEpochEnd();
    let secondsUntilEpochEnd = await dsecDistribution.getSecondsUntilEpochEnd(timeIncreaseTo);
    let currentDsec0 = await dsecDistribution.getDsecForTransferNow(new BN("0"));
    let currentDsec1 = await dsecDistribution.getDsecForTransferNow(depositAmount);

    let addDsec = await dsecDistribution.addDsec(accounts[9], depositAmount);
    expectEvent.notEmitted(addDsec, "DsecAdd");
    for (let epoch = 0; epoch <= ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      let dsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], epoch);
      assert.ok(
        dsecBalance.eq(expectDsecBalance),
        `Epoch ${epoch}: After add DSec balance is ${dsecBalance} instead of ${expectDsecBalance}`
      );
    }

    let removeDsec = await dsecDistribution.removeDsec(accounts[9], depositAmount.div(new BN("2")));
    expectEvent.notEmitted(removeDsec, "DsecRemove");
    for (let epoch = 0; epoch <= ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      let dsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], epoch);
      assert.ok(
        dsecBalance.eq(expectDsecBalance),
        `Epoch ${epoch}: After remove DSec balance is ${dsecBalance} instead of ${expectDsecBalance}`
      );
    }

    assert.ok(
      currentEpoch.eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Current epoch is ${currentEpoch} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      currentEpochStartTimestamp[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Start epoch is ${currentEpochStartTimestamp[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      currentEpochStartTimestamp[1].eq(expectCurrentEpochStartTimestamp),
      `Timestamp ${timeIncreaseTo}: Epoch start timestamp is ${currentEpochStartTimestamp[1]} instead of ${expectCurrentEpochStartTimestamp}`
    );
    assert.ok(
      currentEpochEndTimestamp[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: End epoch is ${currentEpochEndTimestamp[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      currentEpochEndTimestamp[1].eq(expectCurrentEpochEndTimestamp),
      `Timestamp ${timeIncreaseTo}: Epoch end timestamp is ${currentEpochEndTimestamp[1]} instead of ${expectCurrentEpochEndTimestamp}`
    );
    assert.ok(
      epochAtTimestamp.eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Epoch at timestamp is ${epochAtTimestamp} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      epochStartTimestamp[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Epoch start is ${epochStartTimestamp[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      epochStartTimestamp[1].eq(expectCurrentEpochStartTimestamp),
      `Timestamp ${timeIncreaseTo}: Epoch start timestamp is ${epochStartTimestamp[1]} instead of ${expectCurrentEpochStartTimestamp}`
    );
    assert.ok(
      epochEndTimestamp[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Epoch end is ${epochEndTimestamp[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      epochEndTimestamp[1].eq(expectCurrentEpochEndTimestamp),
      `Timestamp ${timeIncreaseTo}: Epoch end timestamp is ${epochEndTimestamp[1]} instead of ${expectCurrentEpochEndTimestamp}`
    );
    assert.ok(
      secondsUntilCurrentEpochEnd[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Seconds epoch is ${secondsUntilCurrentEpochEnd[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      secondsUntilCurrentEpochEnd[1].eq(expectSecondsUntilCurrentEpochEnd),
      `Timestamp ${timeIncreaseTo}: Seconds until current epoch end is ${secondsUntilCurrentEpochEnd[1]} instead of ${expectSecondsUntilCurrentEpochEnd}`
    );
    assert.ok(
      secondsUntilEpochEnd[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Seconds epoch is ${secondsUntilEpochEnd[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      secondsUntilEpochEnd[1].eq(expectSecondsUntilCurrentEpochEnd),
      `Timestamp ${timeIncreaseTo}: Seconds until current epoch end is ${secondsUntilEpochEnd[1]} instead of ${expectSecondsUntilCurrentEpochEnd}`
    );
    assert.ok(
      currentDsec0[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: DSec 0 epoch is ${currentDsec0[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      currentDsec0[1].eq(expectCurrentDsec),
      `Timestamp ${timeIncreaseTo}: DSec 0 is ${currentDsec0[1]} instead of ${expectCurrentDsec}`
    );
    assert.ok(
      currentDsec1[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: DSec 1 epoch is ${currentDsec1[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      currentDsec1[1].eq(expectCurrentDsec),
      `Timestamp ${timeIncreaseTo}: DSec 1 is ${currentDsec1[1]} instead of ${expectCurrentDsec}`
    );

    timeIncreaseTo = ExpectGovernanceForming.endTimestamp.add(time.duration.years(2));
    await time.increaseTo(timeIncreaseTo);

    currentEpoch = await dsecDistribution.getCurrentEpoch();
    currentEpochStartTimestamp = await dsecDistribution.getCurrentEpochStartTimestamp();
    currentEpochEndTimestamp = await dsecDistribution.getCurrentEpochEndTimestamp();
    epochAtTimestamp = await dsecDistribution.getEpoch(timeIncreaseTo);
    epochStartTimestamp = await dsecDistribution.getEpochStartTimestamp(timeIncreaseTo);
    epochEndTimestamp = await dsecDistribution.getEpochEndTimestamp(timeIncreaseTo);
    secondsUntilCurrentEpochEnd = await dsecDistribution.getSecondsUntilCurrentEpochEnd();
    secondsUntilEpochEnd = await dsecDistribution.getSecondsUntilEpochEnd(timeIncreaseTo);
    currentDsec0 = await dsecDistribution.getDsecForTransferNow(new BN("0"));
    currentDsec1 = await dsecDistribution.getDsecForTransferNow(
      new BN(web3.utils.toWei("4833718947.307929841700919000", "ether"))
    );

    addDsec = await dsecDistribution.addDsec(accounts[9], depositAmount);
    expectEvent.notEmitted(addDsec, "DsecAdd");
    removeDsec = await dsecDistribution.removeDsec(accounts[9], depositAmount);
    expectEvent.notEmitted(removeDsec, "DsecRemove");
    for (let epoch = 0; epoch <= ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      let dsecBalance = await dsecDistribution.dsecBalanceFor(accounts[9], epoch);
      assert.ok(
        dsecBalance.eq(expectDsecBalance),
        `Epoch ${epoch}: DSec balance is ${dsecBalance} instead of ${expectDsecBalance}`
      );
    }

    assert.ok(
      currentEpoch.eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Current epoch is ${currentEpoch} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      currentEpochStartTimestamp[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Start epoch is ${currentEpochStartTimestamp[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      currentEpochStartTimestamp[1].eq(expectCurrentEpochStartTimestamp),
      `Timestamp ${timeIncreaseTo}: Epoch start timestamp is ${currentEpochStartTimestamp[1]} instead of ${expectCurrentEpochStartTimestamp}`
    );
    assert.ok(
      currentEpochEndTimestamp[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: End epoch is ${currentEpochEndTimestamp[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      currentEpochEndTimestamp[1].eq(expectCurrentEpochEndTimestamp),
      `Timestamp ${timeIncreaseTo}: Epoch end timestamp is ${currentEpochEndTimestamp[1]} instead of ${expectCurrentEpochEndTimestamp}`
    );
    assert.ok(
      epochAtTimestamp.eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Epoch at timestamp is ${epochAtTimestamp} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      epochStartTimestamp[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Epoch start is ${epochStartTimestamp[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      epochStartTimestamp[1].eq(expectCurrentEpochStartTimestamp),
      `Timestamp ${timeIncreaseTo}: Epoch start timestamp is ${epochStartTimestamp[1]} instead of ${expectCurrentEpochStartTimestamp}`
    );
    assert.ok(
      epochEndTimestamp[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Epoch end is ${epochEndTimestamp[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      epochEndTimestamp[1].eq(expectCurrentEpochEndTimestamp),
      `Timestamp ${timeIncreaseTo}: Epoch end timestamp is ${epochEndTimestamp[1]} instead of ${expectCurrentEpochEndTimestamp}`
    );
    assert.ok(
      secondsUntilCurrentEpochEnd[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Seconds epoch is ${secondsUntilCurrentEpochEnd[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      secondsUntilCurrentEpochEnd[1].eq(expectSecondsUntilCurrentEpochEnd),
      `Timestamp ${timeIncreaseTo}: Seconds until current epoch end is ${secondsUntilCurrentEpochEnd[1]} instead of ${expectSecondsUntilCurrentEpochEnd}`
    );
    assert.ok(
      secondsUntilEpochEnd[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: Seconds epoch is ${secondsUntilEpochEnd[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      secondsUntilEpochEnd[1].eq(expectSecondsUntilCurrentEpochEnd),
      `Timestamp ${timeIncreaseTo}: Seconds until current epoch end is ${secondsUntilEpochEnd[1]} instead of ${expectSecondsUntilCurrentEpochEnd}`
    );
    assert.ok(
      currentDsec0[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: DSec 0 epoch is ${currentDsec0[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      currentDsec0[1].eq(expectCurrentDsec),
      `Timestamp ${timeIncreaseTo}: DSec 0 is ${currentDsec0[1]} instead of ${expectCurrentDsec}`
    );
    assert.ok(
      currentDsec1[0].eq(expectCurrentEpoch),
      `Timestamp ${timeIncreaseTo}: DSec 1 epoch is ${currentDsec1[0]} instead of ${expectCurrentEpoch}`
    );
    assert.ok(
      currentDsec1[1].eq(expectCurrentDsec),
      `Timestamp ${timeIncreaseTo}: DSec 1 is ${currentDsec1[1]} instead of ${expectCurrentDsec}`
    );
  });

  it("should redeem correct reward amount for dsec", async () => {
    const usersDepositsWithdraws = [
      {
        // epoch: 0
        timestamp: new BN("1641865788"),
        account: accounts[9],
        depositAmount: new BN(web3.utils.toWei("3927530559.004317734748937340", "ether")),
      },
      {
        // epoch: 0
        timestamp: new BN("1641958967"),
        account: accounts[8],
        depositAmount: new BN(web3.utils.toWei("4647.076987922009405500", "ether")),
      },
      {
        // epoch: 0
        timestamp: new BN("1642077933"),
        account: accounts[9],
        depositAmount: new BN(web3.utils.toWei("-1135543.917594683046470000", "ether")),
      },
      {
        // epoch: 0
        timestamp: new BN("1642234794"),
        account: accounts[8],
        depositAmount: new BN(web3.utils.toWei("62990.199352490630482000", "ether")),
      },
      {
        // epoch: 0
        timestamp: new BN("1642245213"),
        account: accounts[7],
        depositAmount: new BN(web3.utils.toWei("450432.793976033823551000", "ether")),
      },
      {
        // epoch: 0
        timestamp: new BN("1642254666"),
        account: accounts[8],
        depositAmount: new BN(web3.utils.toWei("-3859.767716083814211000", "ether")),
      },
      {
        // epoch: 0
        timestamp: new BN("1642259638"),
        account: accounts[8],
        depositAmount: new BN(web3.utils.toWei("388408.792734177287742000", "ether")),
      },
      {
        // epoch: 0
        timestamp: new BN("1642261163"),
        account: accounts[9],
        depositAmount: new BN(web3.utils.toWei("-291531.185426636893376000", "ether")),
      },
    ];

    const testEpoch = 0;

    let expectDsecs = {};
    expectDsecs[accounts[7]] = {
      testEpoch: new BN("0"),
      afterTestEpoch: new BN("0"),
    };
    expectDsecs[accounts[8]] = {
      testEpoch: new BN("0"),
      afterTestEpoch: new BN("0"),
    };
    expectDsecs[accounts[9]] = {
      testEpoch: new BN("0"),
      afterTestEpoch: new BN("0"),
    };

    for (let i = 0; i < 5; i++) {
      await time.increaseTo(usersDepositsWithdraws[i].timestamp);

      let dsecTransfer;
      let dsecTransferBlockTimestamp;
      let dsecToAddTestEpoch;
      let dsecToAddAfterTestEpoch;

      if (usersDepositsWithdraws[i].depositAmount.gte(new BN("0"))) {
        dsecTransfer = await dsecDistribution.addDsec(
          usersDepositsWithdraws[i].account,
          usersDepositsWithdraws[i].depositAmount
        );
        dsecTransferBlockTimestamp = await testUtil.getBlockTimestamp(dsecTransfer.receipt.blockHash);

        dsecToAddTestEpoch = usersDepositsWithdraws[i].depositAmount.mul(
          expectEpochEndTimestamps[testEpoch].sub(dsecTransferBlockTimestamp)
        );

        dsecToAddAfterTestEpoch = usersDepositsWithdraws[i].depositAmount.mul(ExpectGovernanceForming.epochDuration);
      } else {
        dsecTransfer = await dsecDistribution.removeDsec(
          usersDepositsWithdraws[i].account,
          usersDepositsWithdraws[i].depositAmount.neg()
        );
        dsecTransferBlockTimestamp = await testUtil.getBlockTimestamp(dsecTransfer.receipt.blockHash);

        dsecToAddTestEpoch = usersDepositsWithdraws[i].depositAmount
          .mul(expectEpochEndTimestamps[testEpoch].sub(dsecTransferBlockTimestamp))
          .mul(new BN(web3.utils.toWei("1.2", "ether")))
          .div(new BN(web3.utils.toWei("1", "ether")));

        dsecToAddAfterTestEpoch = usersDepositsWithdraws[i].depositAmount.mul(ExpectGovernanceForming.epochDuration);
      }

      const dsecBalance = await dsecDistribution.dsecBalanceFor(usersDepositsWithdraws[i].account, testEpoch);
      const dsecBalanceBlockTimestamp = await time.latest();

      expectDsecs[usersDepositsWithdraws[i].account].testEpoch =
        expectDsecs[usersDepositsWithdraws[i].account].testEpoch.add(dsecToAddTestEpoch);

      assert.ok(
        dsecBalance.eq(expectDsecs[usersDepositsWithdraws[i].account].testEpoch),
        `Index ${i} (Timestamp ${dsecTransferBlockTimestamp}): dsecBalance for epoch ${testEpoch} is ${dsecBalance} instead of ${
          expectDsecs[usersDepositsWithdraws[i].account].testEpoch
        }`
      );

      expectDsecs[usersDepositsWithdraws[i].account].afterTestEpoch =
        expectDsecs[usersDepositsWithdraws[i].account].afterTestEpoch.add(dsecToAddAfterTestEpoch);

      const calculateRewardFor = await dsecDistribution.calculateRewardFor(
        accounts[9],
        testEpoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      const expectCalculateRewardFor = new BN("0");
      assert.ok(
        calculateRewardFor.eq(expectCalculateRewardFor),
        `Index ${i} (Timestamp ${dsecTransferBlockTimestamp}): calculateRewardFor is ${calculateRewardFor} instead of ${expectCalculateRewardFor}`
      );

      const redeemDsec = await dsecDistribution.redeemDsec(
        usersDepositsWithdraws[i].account,
        testEpoch,
        DISTRIBUTION_AMOUNT_PER_EPOCH
      );
      expectEvent.notEmitted(redeemDsec, "DsecRedeem");
    }

    let totalDsecTestEpoch = new BN("0");
    let totalDsecAfterTestEpoch = new BN("0");

    for (let account in expectDsecs) {
      totalDsecTestEpoch = totalDsecTestEpoch.add(expectDsecs[account].testEpoch);
      totalDsecAfterTestEpoch = totalDsecAfterTestEpoch.add(expectDsecs[account].afterTestEpoch);
    }

    await time.increaseTo(ExpectGovernanceForming.endTimestamp);

    for (let epoch = 0; epoch < ExpectGovernanceForming.totalNumberOfEpochs; epoch++) {
      let totalReward = new BN("0");

      for (let account in expectDsecs) {
        const calculateRewardFor = await dsecDistribution.calculateRewardFor(
          account,
          epoch,
          DISTRIBUTION_AMOUNT_PER_EPOCH
        );
        const estimateRewardForCurrentEpoch = await dsecDistribution.estimateRewardForCurrentEpoch(
          account,
          DISTRIBUTION_AMOUNT_PER_EPOCH
        );
        const redeemDsec = await dsecDistribution.redeemDsec(account, epoch, DISTRIBUTION_AMOUNT_PER_EPOCH);

        let expectRewardAmount;
        if (epoch == testEpoch) {
          expectRewardAmount = DISTRIBUTION_AMOUNT_PER_EPOCH.mul(expectDsecs[account].testEpoch).div(
            totalDsecTestEpoch
          );
        } else {
          expectRewardAmount = DISTRIBUTION_AMOUNT_PER_EPOCH.mul(expectDsecs[account].afterTestEpoch).div(
            totalDsecAfterTestEpoch
          );
        }

        const expectEstimateRewardForCurrentEpoch = new BN("0");

        totalReward = totalReward.add(expectRewardAmount);

        assert.ok(
          calculateRewardFor.eq(expectRewardAmount),
          `Epoch ${epoch} Account ${account}: calculateRewardFor is ${calculateRewardFor} instead of ${expectRewardAmount}`
        );

        assert.ok(
          estimateRewardForCurrentEpoch.eq(expectEstimateRewardForCurrentEpoch),
          `Epoch ${epoch} Account ${account}: estimateRewardForCurrentEpoch is ${estimateRewardForCurrentEpoch} instead of ${expectEstimateRewardForCurrentEpoch}`
        );

        expectEvent(redeemDsec, "DsecRedeem", {
          account: account,
          epoch: new BN(epoch),
          distributionAmount: DISTRIBUTION_AMOUNT_PER_EPOCH,
          rewardAmount: expectRewardAmount,
        });
      }

      const expectTotalReward = DISTRIBUTION_AMOUNT_PER_EPOCH;
      const expectTotalRewardDiff = new BN(web3.utils.toWei("0.000000000000000002", "ether"));

      const totalRewardDiff = totalReward.sub(expectTotalReward).abs();

      assert.ok(
        totalRewardDiff.lte(expectTotalRewardDiff),
        `totalReward is ${totalReward} instead of ${expectTotalReward}`
      );
    }
  });
});
