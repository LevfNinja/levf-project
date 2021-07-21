const assert = require("assert");
const { expectEvent, expectRevert } = require("@openzeppelin/test-helpers");
const { BN, BN_ZERO, BN_ONE, ether, wei, ZERO_ADDRESS, ...testUtil } = require("./testUtil");

describe("Lfi", () => {
  let accounts;
  let defaultGovernanceAccount;
  let defaultTeamAccount;
  let lfi;

  before(async () => {
    accounts = await web3.eth.getAccounts();
    defaultGovernanceAccount = accounts[0];
    defaultTeamAccount = accounts[1];
  });

  beforeEach(async () => {
    lfi = await testUtil.newLfi();
  });

  it("should be initialized correctly", async () => {
    const name = await lfi.name();
    const symbol = await lfi.symbol();
    const decimals = await lfi.decimals();
    const cap = await lfi.cap();
    const feePercentage = await lfi.feePercentage();
    const teamPreMinted = await lfi.teamPreMinted();
    const teamAccount = await lfi.teamAccount();
    const lfiBalanceOfTeamAccount = await lfi.balanceOf(teamAccount);
    const initialTotalSupply = await lfi.totalSupply();
    const governanceAccount = await lfi.governanceAccount();

    const expectName = "Levf Finance";
    const expectSymbol = "LFI";
    const expectDecimals = 18;
    const expectCap = ether("100000");
    const expectFeePercentage = 10;
    const expectTeamAccount = defaultTeamAccount;
    const expectTeamPreMinted = ether("10000");
    const expectLfiBalanceOfTeamAccount = expectTeamPreMinted;
    const expectInitialTotalSupply = expectCap;
    const expectGovernanceAccount = defaultGovernanceAccount;

    await expectRevert(testUtil.newLfi(undefined, undefined, 0, undefined, undefined, ZERO_ADDRESS), "tTotal is 0");
    await expectRevert(testUtil.newLfi(undefined, undefined, undefined, 101, undefined, ZERO_ADDRESS), "fee >= 100%");
    await expectRevert(
      testUtil.newLfi(undefined, undefined, undefined, undefined, undefined, ZERO_ADDRESS),
      "LFI: team account is the zero address"
    );

    assert.strictEqual(name, expectName, `Name is ${name} instead of ${expectName}`);
    assert.strictEqual(symbol, expectSymbol, `Symbol is ${symbol} instead of ${expectSymbol}`);
    assert.strictEqual(decimals.toNumber(), expectDecimals, `Decimals is ${decimals} instead of ${expectDecimals}`);
    assert.ok(cap.eq(expectCap), `Max supply is ${cap} instead of ${expectCap}`);
    assert.strictEqual(
      feePercentage.toNumber(),
      expectFeePercentage,
      `Fee percentage is ${feePercentage} instead of ${expectFeePercentage}`
    );
    assert.ok(
      teamPreMinted.eq(expectTeamPreMinted),
      `Team pre-minted is ${teamPreMinted} instead of ${expectTeamPreMinted}`
    );
    assert.strictEqual(
      teamAccount,
      expectTeamAccount,
      `Team account is ${teamAccount} instead of ${expectTeamAccount}`
    );
    assert.ok(
      lfiBalanceOfTeamAccount.eq(expectLfiBalanceOfTeamAccount),
      `LFI balance of team account is ${lfiBalanceOfTeamAccount} instead of ${expectLfiBalanceOfTeamAccount}`
    );
    assert.ok(
      initialTotalSupply.eq(expectInitialTotalSupply),
      `Initial total supply is ${initialTotalSupply} instead of ${expectInitialTotalSupply}`
    );
    assert.strictEqual(
      governanceAccount,
      expectGovernanceAccount,
      `Governance account is ${governanceAccount} instead of token creator ${expectGovernanceAccount}`
    );
  });

  it("should only allow governance account to change governance account", async () => {
    const nonGovernanceAccount = accounts[5];

    await expectRevert(
      lfi.setGovernanceAccount(nonGovernanceAccount, { from: nonGovernanceAccount }),
      "LFI: sender not authorized"
    );
    await assert.doesNotReject(
      async () => await lfi.setGovernanceAccount(defaultGovernanceAccount, { from: defaultGovernanceAccount })
    );
  });

  it("should be changed to the specific governance account", async () => {
    const expectNewGovernanceAccount = accounts[5];

    await lfi.setGovernanceAccount(expectNewGovernanceAccount, { from: defaultGovernanceAccount });
    const newGovernanceAccount = await lfi.governanceAccount();

    await expectRevert(
      lfi.setGovernanceAccount(ZERO_ADDRESS, { from: newGovernanceAccount }),
      "LFI: new governance account is the zero address"
    );
    assert.strictEqual(
      newGovernanceAccount,
      expectNewGovernanceAccount,
      `New governance account is ${newGovernanceAccount} instead of ${expectNewGovernanceAccount}`
    );
  });

  it("should only allow governance account to add treasury pool addresses", async () => {
    const nonGovernanceAccount = accounts[5];
    const newGovernanceAccount = accounts[6];
    const existingTreasuryPoolAddress = accounts[7];
    const treasuryPoolAddress1 = accounts[8];
    const treasuryPoolAddress2 = accounts[9];

    await lfi.setGovernanceAccount(newGovernanceAccount, { from: defaultGovernanceAccount });
    await lfi.addTreasuryPoolAddress(existingTreasuryPoolAddress, { from: newGovernanceAccount });

    await expectRevert(
      lfi.addTreasuryPoolAddress(treasuryPoolAddress1, { from: nonGovernanceAccount }),
      "LFI: sender not authorized"
    );
    await expectRevert(
      lfi.addTreasuryPoolAddress(ZERO_ADDRESS, { from: newGovernanceAccount }),
      "LFI: address is the zero address"
    );
    await expectRevert(
      lfi.addTreasuryPoolAddress(existingTreasuryPoolAddress, { from: newGovernanceAccount }),
      "LFI: address is already a treasury pool"
    );
    await assert.doesNotReject(
      async () => await lfi.addTreasuryPoolAddress(treasuryPoolAddress1, { from: newGovernanceAccount })
    );
    await assert.doesNotReject(
      async () => await lfi.addTreasuryPoolAddress(treasuryPoolAddress2, { from: newGovernanceAccount })
    );
    assert.deepStrictEqual(await lfi.treasuryPoolAddresses(), [
      existingTreasuryPoolAddress,
      treasuryPoolAddress1,
      treasuryPoolAddress2,
    ]);
  });

  it("should only allow governance account to remove treasury pool addresses", async () => {
    const nonGovernanceAccount = accounts[5];
    const newGovernanceAccount = accounts[6];
    const nonTreasuryPoolAddress = accounts[7];
    const treasuryPoolAddress1 = accounts[8];
    const treasuryPoolAddress2 = accounts[9];

    await lfi.setGovernanceAccount(newGovernanceAccount, { from: defaultGovernanceAccount });
    await lfi.addTreasuryPoolAddress(treasuryPoolAddress1, { from: newGovernanceAccount });
    await lfi.addTreasuryPoolAddress(treasuryPoolAddress2, { from: newGovernanceAccount });

    await expectRevert(
      lfi.removeTreasuryPoolAddress(treasuryPoolAddress1, { from: nonGovernanceAccount }),
      "LFI: sender not authorized"
    );
    await expectRevert(
      lfi.removeTreasuryPoolAddress(ZERO_ADDRESS, { from: newGovernanceAccount }),
      "LFI: address is the zero address"
    );
    await expectRevert(
      lfi.removeTreasuryPoolAddress(nonTreasuryPoolAddress, { from: newGovernanceAccount }),
      "LFI: address not an existing treasury pool"
    );
    await assert.doesNotReject(
      async () => await lfi.removeTreasuryPoolAddress(treasuryPoolAddress1, { from: newGovernanceAccount })
    );
    await assert.doesNotReject(
      async () => await lfi.removeTreasuryPoolAddress(treasuryPoolAddress2, { from: newGovernanceAccount })
    );
    assert.deepStrictEqual(await lfi.treasuryPoolAddresses(), []);
  });

  it("should only allow owner to excluded accounts", async () => {
    const nonOwner = accounts[5];
    const pendingExcludingAccount = accounts[6];
    const excludedAccount = accounts[7];

    await lfi.excludeAccount(excludedAccount, { from: defaultGovernanceAccount });

    await expectRevert(
      lfi.excludeAccount(excludedAccount, { from: defaultGovernanceAccount }),
      "Account is already excluded"
    );
    await expectRevert.unspecified(lfi.excludeAccount(pendingExcludingAccount, { from: nonOwner }));
    await assert.doesNotReject(
      async () => await lfi.excludeAccount(pendingExcludingAccount, { from: defaultGovernanceAccount })
    );
    assert.strictEqual(
      (await lfi.excludedAccounts()).includes(pendingExcludingAccount),
      true,
      "account is not excluded"
    );
  });

  it("should only allow owner to included accounts", async () => {
    const nonOwner = accounts[5];
    const pendingExcludingAccount = accounts[6];
    const includedAccount = accounts[7];

    await lfi.excludeAccount(pendingExcludingAccount, { from: defaultGovernanceAccount });

    await expectRevert(
      lfi.includeAccount(includedAccount, { from: defaultGovernanceAccount }),
      "Account is already excluded"
    );
    await expectRevert.unspecified(lfi.includeAccount(pendingExcludingAccount, { from: nonOwner }));
    await assert.doesNotReject(
      async () => await lfi.includeAccount(pendingExcludingAccount, { from: defaultGovernanceAccount })
    );
    assert.strictEqual(
      (await lfi.excludedAccounts()).includes(pendingExcludingAccount),
      false,
      "account is not included"
    );
  });

  it("should not allow to redeem to zero address", async () => {
    const treasuryPoolAddress = accounts[5];

    await lfi.addTreasuryPoolAddress(treasuryPoolAddress, { from: defaultGovernanceAccount });

    await expectRevert(
      lfi.redeem(ZERO_ADDRESS, ether("1"), { from: treasuryPoolAddress }),
      "LFI: redeem to the zero address"
    );
  });

  it("should not allow to redeem 0", async () => {
    const treasuryPoolAddress = accounts[5];

    await lfi.addTreasuryPoolAddress(treasuryPoolAddress, { from: defaultGovernanceAccount });

    await expectRevert(lfi.redeem(treasuryPoolAddress, ether("0"), { from: treasuryPoolAddress }), "LFI: redeem 0");
  });

  it("should only allow treasury pools to redeem", async () => {
    const removedTreasuryPoolAddress = accounts[5];
    const treasuryPoolAddress = accounts[6];
    const nonTreasuryPoolAddress = accounts[7];

    await lfi.addTreasuryPoolAddress(removedTreasuryPoolAddress, { from: defaultGovernanceAccount });
    await lfi.addTreasuryPoolAddress(treasuryPoolAddress, { from: defaultGovernanceAccount });
    await lfi.removeTreasuryPoolAddress(removedTreasuryPoolAddress, { from: defaultGovernanceAccount });

    const amountToRedeem = ether("1");
    const expectedRedeemedAmount = await testUtil.estimateLfiBalanceAfterTransfer(
      lfi,
      lfi.address,
      nonTreasuryPoolAddress,
      amountToRedeem,
      "recipient"
    );
    await lfi.redeem(nonTreasuryPoolAddress, amountToRedeem, { from: treasuryPoolAddress });
    const actualRedeemedAmount = await lfi.balanceOf(nonTreasuryPoolAddress);

    await expectRevert(
      lfi.redeem(nonTreasuryPoolAddress, amountToRedeem, { from: nonTreasuryPoolAddress }),
      "LFI: sender not a treasury pool"
    );
    await expectRevert(
      lfi.redeem(nonTreasuryPoolAddress, amountToRedeem, { from: removedTreasuryPoolAddress }),
      "LFI: sender not a treasury pool"
    );
    assert.ok(
      testUtil.bnDiffInRange(actualRedeemedAmount, expectedRedeemedAmount, BN_ONE),
      `Actual redeemed amount ${actualRedeemedAmount} is not close to ${expectedRedeemedAmount}`
    );
  });

  it("can be fully redeemed", async () => {
    const treasuryPoolAddress = accounts[5];

    const totalSupply = await lfi.totalSupply();
    let redeemedAmount = await lfi.teamPreMinted();
    await lfi.addTreasuryPoolAddress(treasuryPoolAddress, { from: defaultGovernanceAccount });

    let normalTries = 100;
    let redeemAmount = totalSupply.sub(redeemedAmount).sub(wei("100")).div(new BN(normalTries));
    for (let i = 0; i < normalTries; i++) {
      redeemedAmount = redeemedAmount.add(redeemAmount);
      await lfi.redeem(treasuryPoolAddress, redeemAmount, { from: treasuryPoolAddress });
    }

    // min value: 1 wei
    redeemAmount = wei("1");
    while (redeemedAmount.lt(totalSupply)) {
      redeemedAmount = redeemedAmount.add(redeemAmount);
      await lfi.redeem(treasuryPoolAddress, redeemAmount, { from: treasuryPoolAddress });
    }

    assert.ok(redeemedAmount.eq(totalSupply), `Redeemed amount is ${redeemedAmount} instead of ${totalSupply}`);
  });

  it("should not allow to approve for the zero address", async () => {
    await expectRevert(
      lfi.approve(ZERO_ADDRESS, ether("1"), { from: defaultTeamAccount }),
      "ERC20: approve to the zero address"
    );
  });

  it("should not allow to transfer to zero address", async () => {
    await expectRevert(
      lfi.transfer(ZERO_ADDRESS, ether("1"), { from: defaultTeamAccount }),
      "ERC20: transfer to the zero address"
    );
  });

  it("should not allow to transfer 0", async () => {
    const recipient = accounts[5];

    await expectRevert(
      lfi.transfer(recipient, ether("0"), { from: defaultTeamAccount }),
      "Transfer amount must be greater than zero"
    );
  });

  it("should only allow transfers not exceeding the allowance", async () => {
    const spender1 = accounts[5];
    const spender2 = accounts[6];
    const spender3 = accounts[7];

    await lfi.approve(spender1, ether("1"), { from: defaultTeamAccount });
    await lfi.approve(spender2, ether("1"), { from: defaultTeamAccount });
    await lfi.approve(spender3, ether("1"), { from: defaultTeamAccount });
    await lfi.increaseAllowance(spender2, ether("2"), { from: defaultTeamAccount });
    await lfi.increaseAllowance(spender3, ether("2"), { from: defaultTeamAccount });
    await lfi.decreaseAllowance(spender2, ether("1"), { from: defaultTeamAccount });

    const allowanceOfSpender1 = await lfi.allowance(defaultTeamAccount, spender1);
    const allowanceOfSpender2 = await lfi.allowance(defaultTeamAccount, spender2);
    const allowanceOfSpender3 = await lfi.allowance(defaultTeamAccount, spender3);

    const expectAllowanceOfSpender1 = ether("1");
    const expectAllowanceOfSpender2 = ether("2");
    const expectAllowanceOfSpender3 = ether("3");

    assert.ok(
      allowanceOfSpender1.eq(expectAllowanceOfSpender1),
      `Allow of spender1 is ${allowanceOfSpender1} instead of ${expectAllowanceOfSpender1}`
    );
    assert.ok(
      allowanceOfSpender2.eq(expectAllowanceOfSpender2),
      `Allow of spender2 is ${allowanceOfSpender2} instead of ${expectAllowanceOfSpender2}`
    );
    assert.ok(
      allowanceOfSpender3.eq(expectAllowanceOfSpender3),
      `Allow of spender3 is ${allowanceOfSpender3} instead of ${expectAllowanceOfSpender3}`
    );

    await expectRevert(
      lfi.transferFrom(defaultTeamAccount, defaultGovernanceAccount, ether("1").add(wei("1")), { from: spender1 }),
      "ERC20: transfer amount exceeds allowance"
    );
    await expectRevert(
      lfi.transferFrom(defaultTeamAccount, defaultGovernanceAccount, ether("2").add(wei("1")), { from: spender2 }),
      "ERC20: transfer amount exceeds allowance"
    );
    await expectRevert(
      lfi.transferFrom(defaultTeamAccount, defaultGovernanceAccount, ether("3").add(wei("1")), { from: spender3 }),
      "ERC20: transfer amount exceeds allowance"
    );

    await assert.doesNotReject(async () =>
      lfi.transferFrom(defaultTeamAccount, defaultGovernanceAccount, ether("1"), { from: spender1 })
    );
    await assert.doesNotReject(async () =>
      lfi.transferFrom(defaultTeamAccount, defaultGovernanceAccount, ether("2"), { from: spender2 })
    );
    await assert.doesNotReject(async () =>
      lfi.transferFrom(defaultTeamAccount, defaultGovernanceAccount, ether("3"), { from: spender3 })
    );
  });

  it("should be transferred to 3 recipients one after another correctly", async () => {
    const expectName = "Levf Finance";
    const expectSymbol = "LFI";
    const expectDecimals = new BN("18");

    const expectInitialTotalSupply = ether("100000");
    const expectInitialTotalFees = BN_ZERO;
    const expectInitialReflectionTotal = new BN(
      "115792089237316195423570985008687907853269984665640564000000000000000000000000"
    );
    const expectInitialUnmintedLfiAmount = ether("90000");
    const expectInitialUnmintedLfiReflection = expectInitialUnmintedLfiAmount
      .mul(expectInitialReflectionTotal)
      .div(expectInitialTotalSupply);
    const expectFeePercentage = new BN(10);

    const recipients = [
      {
        senderAccount: defaultTeamAccount,
        recipientAccount: accounts[5],
        senderTransferAmount: ether("9783.45671664226"),
        expectRecipientTransferAmount: ether("8805.111044978034"), // 90% of sender transfer amount due to 10% fee
        expectTransactionFee: ether("978.345671664226"), // 10% of sender transfer amount as fee
        expectBalanceOfSenderBeforeTransfer: ether("10000"),
        expectBalanceOfRecipientBeforeTransfer: BN_ZERO,
        expectROwnedOfSenderBeforeTransfer: new BN(
          "11579208923731619542357098500868790785326998466564056400000000000000000000000"
        ),
        expectTOwnedOfSenderBeforeTransfer: BN_ZERO,
        expectROwnedOfRecipientBeforeTransfer: BN_ZERO,
        expectTOwnedOfRecipientBeforeTransfer: BN_ZERO,
        expectCurrentReflectionSupplyBeforeTransfer: expectInitialReflectionTotal,
        expectUnmintedLfiAmountBeforeTransfer: expectInitialUnmintedLfiAmount,
        expectUnmintedLfiReflectionBeforeTransfer: expectInitialUnmintedLfiReflection,
      },
      {
        senderAccount: accounts[5],
        recipientAccount: accounts[6],
        senderTransferAmount: ether("2633.70842268487"),
        expectRecipientTransferAmount: ether("2370.337580416383"), // 90% of sender transfer amount due to 10% fee
        expectTransactionFee: ether("263.370842268487"), // 10% of sender transfer amount as fee
        expectBalanceOfSenderBeforeTransfer: ether("8805.111044978034")
          .mul(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount))
          .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount).sub(ether("978.345671664226"))), // recipients[0].expectRecipientTransferAmount + proportion of recipients[0].expectTransactionFee
        expectBalanceOfRecipientBeforeTransfer: BN_ZERO,
        expectROwnedOfSenderBeforeTransfer: ether("8805.111044978034")
          .mul(expectInitialReflectionTotal.sub(expectInitialUnmintedLfiReflection))
          .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount)),
        expectTOwnedOfSenderBeforeTransfer: BN_ZERO,
        expectROwnedOfRecipientBeforeTransfer: BN_ZERO,
        expectTOwnedOfRecipientBeforeTransfer: BN_ZERO,
        expectCurrentReflectionSupplyBeforeTransfer: expectInitialReflectionTotal.sub(
          ether("978.345671664226")
            .mul(expectInitialReflectionTotal.sub(expectInitialUnmintedLfiReflection))
            .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount))
        ),
        expectUnmintedLfiAmountBeforeTransfer: expectInitialUnmintedLfiAmount,
        expectUnmintedLfiReflectionBeforeTransfer: expectInitialUnmintedLfiReflection,
      },
      {
        senderAccount: accounts[5],
        recipientAccount: accounts[7],
        senderTransferAmount: ether("137.073628199795"),
        expectRecipientTransferAmount: ether("123.3662653798155"), // 90% of sender transfer amount due to 10% fee
        expectTransactionFee: ether("13.7073628199795"), // 10% of sender transfer amount as fee
        expectBalanceOfSenderBeforeTransfer: ether("8805.111044978034")
          .mul(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount))
          .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount).sub(ether("978.345671664226")))
          .sub(ether("2633.70842268487"))
          .mul(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount))
          .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount).sub(ether("263.370842268487"))), // recipients[0].expectRecipientTransferAmount + proportion of recipients[0].expectTransactionFee
        expectBalanceOfRecipientBeforeTransfer: BN_ZERO,
        expectROwnedOfSenderBeforeTransfer: ether("8805.111044978034")
          .mul(expectInitialReflectionTotal.sub(expectInitialUnmintedLfiReflection))
          .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount))
          .sub(
            ether("2633.70842268487").mul(
              expectInitialReflectionTotal
                .sub(expectInitialUnmintedLfiReflection)
                .sub(
                  ether("978.345671664226").mul(
                    expectInitialReflectionTotal
                      .sub(expectInitialUnmintedLfiReflection)
                      .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount))
                  )
                )
                .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount))
            ) // calculate rate as standalone to keep same precision as contract
          ),
        expectTOwnedOfSenderBeforeTransfer: BN_ZERO,
        expectROwnedOfRecipientBeforeTransfer: BN_ZERO,
        expectTOwnedOfRecipientBeforeTransfer: BN_ZERO,
        expectCurrentReflectionSupplyBeforeTransfer: expectInitialReflectionTotal
          .sub(
            ether("978.345671664226")
              .mul(expectInitialReflectionTotal.sub(expectInitialUnmintedLfiReflection))
              .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount))
          )
          .sub(
            ether("263.370842268487").mul(
              expectInitialReflectionTotal
                .sub(expectInitialUnmintedLfiReflection)
                .sub(
                  ether("978.345671664226")
                    .mul(expectInitialReflectionTotal.sub(expectInitialUnmintedLfiReflection))
                    .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount))
                )
                .div(expectInitialTotalSupply.sub(expectInitialUnmintedLfiAmount))
            ) // calculate rate as standalone to keep same precision as contract
          ),
        expectUnmintedLfiAmountBeforeTransfer: expectInitialUnmintedLfiAmount,
        expectUnmintedLfiReflectionBeforeTransfer: expectInitialUnmintedLfiReflection,
      },
    ];

    const name = await lfi.name();
    const symbol = await lfi.symbol();
    const decimals = await lfi.decimals();
    const initialTotalSupply = await lfi.totalSupply();
    const initialTotalFees = await lfi.totalFees();
    const feePercentage = await lfi.feePercentage();
    const initialReflectionTotal = await lfi.rTotal();
    const initialUnmintedLfiAmount = await lfi.balanceOf(lfi.address);
    const initialUnmintedLfiReflection = await lfi.rOwned(lfi.address);

    assert.strictEqual(name, expectName, `Name is ${name} instead of ${expectName}`);
    assert.strictEqual(symbol, expectSymbol, `Symbol is ${symbol} instead of ${expectSymbol}`);

    assert.ok(decimals.eq(expectDecimals), `Decimals is ${decimals} instead of ${expectDecimals}`);

    assert.ok(
      initialTotalSupply.eq(expectInitialTotalSupply),
      `Initial total supply is ${initialTotalSupply} instead of ${expectInitialTotalSupply}`
    );

    assert.ok(
      initialTotalFees.eq(expectInitialTotalFees),
      `Initial total fees is ${initialTotalFees} instead of ${expectInitialTotalFees}`
    );

    assert.ok(
      feePercentage.eq(expectFeePercentage),
      `Fee percentage is ${feePercentage} instead of ${expectFeePercentage}`
    );

    assert.ok(
      initialReflectionTotal.eq(expectInitialReflectionTotal),
      `Initial reflection total is ${initialReflectionTotal} instead of ${expectInitialReflectionTotal}`
    );

    assert.ok(
      initialUnmintedLfiAmount.eq(expectInitialUnmintedLfiAmount),
      `Initial unminted LFI amount is ${initialUnmintedLfiAmount} instead of ${expectInitialUnmintedLfiAmount}`
    );

    assert.ok(
      initialUnmintedLfiReflection.eq(expectInitialUnmintedLfiReflection),
      `Initial unminted LFI reflection is ${initialUnmintedLfiReflection} instead of ${expectInitialUnmintedLfiReflection}`
    );

    // Transfer to Recipients
    let currentReflectionTotalBeforeTransfer = expectInitialReflectionTotal;
    let currentTotalFeesBeforeTransfer = BN_ZERO;

    for (let i = 0; i < recipients.length; i++) {
      console.log(`${i}: currentReflectionTotalBeforeTransfer: ${currentReflectionTotalBeforeTransfer}`);

      const senderAccount = recipients[i].senderAccount;
      const recipientAccount = recipients[i].recipientAccount;
      const transferAmount = recipients[i].senderTransferAmount;
      const expectTransferAmount = recipients[i].expectRecipientTransferAmount;
      const expectTransactionFee = recipients[i].expectTransactionFee;

      const expectBalanceOfSenderBeforeTransfer = recipients[i].expectBalanceOfSenderBeforeTransfer;
      const expectBalanceOfRecipientBeforeTransfer = recipients[i].expectBalanceOfRecipientBeforeTransfer;
      const expectTokenFromReflectionOfSenderBeforeTransfer = expectBalanceOfSenderBeforeTransfer;
      const expectTokenFromReflectionOfRecipientBeforeTransfer = expectBalanceOfRecipientBeforeTransfer;
      const expectROwnedOfSenderBeforeTransfer = recipients[i].expectROwnedOfSenderBeforeTransfer;
      const expectTOwnedOfSenderBeforeTransfer = recipients[i].expectTOwnedOfSenderBeforeTransfer;
      const expectROwnedOfRecipientBeforeTransfer = recipients[i].expectROwnedOfRecipientBeforeTransfer;
      const expectTOwnedOfRecipientBeforeTransfer = recipients[i].expectTOwnedOfRecipientBeforeTransfer;
      const expectCurrentReflectionSupplyBeforeTransfer = recipients[i].expectCurrentReflectionSupplyBeforeTransfer;
      const expectCurrentTokenSupplyBeforeTransfer = expectInitialTotalSupply;
      const expectRateBeforeTransfer = expectCurrentReflectionSupplyBeforeTransfer
        .sub(recipients[i].expectUnmintedLfiReflectionBeforeTransfer)
        .div(expectCurrentTokenSupplyBeforeTransfer.sub(recipients[i].expectUnmintedLfiAmountBeforeTransfer));

      const balanceOfSenderBeforeTransfer = await lfi.balanceOf(senderAccount);
      const balanceOfRecipientBeforeTransfer = await lfi.balanceOf(recipientAccount);
      const tokenFromReflectionOfSenderBeforeTransfer = await lfi.tokenFromReflection(
        expectROwnedOfSenderBeforeTransfer
      );
      const tokenFromReflectionOfRecipientBeforeTransfer = await lfi.tokenFromReflection(
        expectROwnedOfRecipientBeforeTransfer
      );
      const rOwnedOfSenderBeforeTransfer = await lfi.rOwned(senderAccount);
      const tOwnedOfSenderBeforeTransfer = await lfi.tOwned(senderAccount);
      const rOwnedOfRecipientBeforeTransfer = await lfi.rOwned(recipientAccount);
      const tOwnedOfRecipientBeforeTransfer = await lfi.tOwned(recipientAccount);

      console.log(`${i}: rOwnedOfSenderBeforeTransfer: ${rOwnedOfSenderBeforeTransfer}`);
      console.log(`${i}: expectROwnedOfSenderBeforeTransfer: ${expectROwnedOfSenderBeforeTransfer}`);

      const balanceOfSenderBeforeTransferDiff = testUtil.bnAbsDiff(
        balanceOfSenderBeforeTransfer,
        expectBalanceOfSenderBeforeTransfer
      );
      assert.ok(
        balanceOfSenderBeforeTransferDiff.lte(BN_ONE),
        `${i}: Balance of sender before transfer is ${balanceOfSenderBeforeTransfer} instead of ${expectBalanceOfSenderBeforeTransfer}`
      );

      assert.ok(
        balanceOfRecipientBeforeTransfer.eq(expectBalanceOfRecipientBeforeTransfer),
        `${i}: Balance of recipient before transfer is ${balanceOfRecipientBeforeTransfer} instead of ${expectBalanceOfRecipientBeforeTransfer}`
      );

      const tokenFromReflectionOfSenderBeforeTransferDiff = testUtil.bnAbsDiff(
        tokenFromReflectionOfSenderBeforeTransfer,
        expectTokenFromReflectionOfSenderBeforeTransfer
      );
      assert.ok(
        tokenFromReflectionOfSenderBeforeTransferDiff.lte(BN_ONE),
        `${i}: Token from reflection of sender before transfer is ${tokenFromReflectionOfSenderBeforeTransfer} instead of ${expectTokenFromReflectionOfSenderBeforeTransfer}`
      );

      assert.ok(
        tokenFromReflectionOfRecipientBeforeTransfer.eq(expectTokenFromReflectionOfRecipientBeforeTransfer),
        `${i}: Token from reflection of recipient before transfer is ${tokenFromReflectionOfRecipientBeforeTransfer} instead of ${expectTokenFromReflectionOfRecipientBeforeTransfer}`
      );

      assert.ok(
        rOwnedOfSenderBeforeTransfer.eq(expectROwnedOfSenderBeforeTransfer),
        `${i}: rOwned of sender before transfer is ${rOwnedOfSenderBeforeTransfer} instead of ${expectROwnedOfSenderBeforeTransfer}`
      );

      assert.ok(
        tOwnedOfSenderBeforeTransfer.eq(expectTOwnedOfSenderBeforeTransfer),
        `${i}: tOwned of sender before transfer is ${tOwnedOfSenderBeforeTransfer} instead of ${expectTOwnedOfSenderBeforeTransfer}`
      );

      assert.ok(
        rOwnedOfRecipientBeforeTransfer.eq(expectROwnedOfRecipientBeforeTransfer),
        `${i}: rOwned of recipient before transfer is ${rOwnedOfRecipientBeforeTransfer} instead of ${expectROwnedOfRecipientBeforeTransfer}`
      );

      assert.ok(
        tOwnedOfRecipientBeforeTransfer.eq(expectTOwnedOfRecipientBeforeTransfer),
        `${i}: tOwned of sender before transfer is ${tOwnedOfRecipientBeforeTransfer} instead of ${expectTOwnedOfRecipientBeforeTransfer}`
      );

      const expectGetValueTokenFee = transferAmount.mul(expectFeePercentage).div(new BN("100"));
      const expectGetValueTokenTransferAmount = transferAmount.sub(expectGetValueTokenFee);

      console.log(`${i}: expectCurrentReflectionSupplyBeforeTransfer: ${expectCurrentReflectionSupplyBeforeTransfer}`);
      console.log(`${i}: expectCurrentTokenSupplyBeforeTransfer: ${expectCurrentTokenSupplyBeforeTransfer}`);
      console.log(`${i}: expectRateBeforeTransfer: ${expectRateBeforeTransfer}`);

      const expectGetValueReflectionAmount = recipients[i].senderTransferAmount.mul(expectRateBeforeTransfer);
      const expectGetValueReflectionFee = expectGetValueTokenFee.mul(expectRateBeforeTransfer);
      const expectGetValueReflectionTransferAmount = expectGetValueReflectionAmount.sub(expectGetValueReflectionFee);

      const expectSenderBalanceAfterTransferBeforeFee = expectBalanceOfSenderBeforeTransfer.sub(transferAmount);
      const expectRecipientBalanceAfterTransferBeforeFee = expectTransferAmount;
      const expectFeeDueSender = expectSenderBalanceAfterTransferBeforeFee
        .mul(expectTransactionFee)
        .div(initialTotalSupply.sub(expectTransactionFee).sub(recipients[i].expectUnmintedLfiAmountBeforeTransfer));
      const expectFeeDueRecipient = expectRecipientBalanceAfterTransferBeforeFee
        .mul(expectTransactionFee)
        .div(initialTotalSupply.sub(expectTransactionFee).sub(recipients[i].expectUnmintedLfiAmountBeforeTransfer));
      const expectBalanceOfSenderAfterTransfer = expectSenderBalanceAfterTransferBeforeFee.add(expectFeeDueSender);
      const expectBalanceOfRecipientAfterTransfer =
        expectRecipientBalanceAfterTransferBeforeFee.add(expectFeeDueRecipient);

      console.log(`${i}: expectSenderBalanceAfterTransferBeforeFee: ${expectSenderBalanceAfterTransferBeforeFee}`);
      console.log(`${i}: expectFeeDueSender: ${expectFeeDueSender}`);
      console.log(`${i}: expectBalanceOfSenderAfterTransfer: ${expectBalanceOfSenderAfterTransfer}`);
      console.log(
        `${i}: expectRecipientBalanceAfterTransferBeforeFee: ${expectRecipientBalanceAfterTransferBeforeFee}`
      );
      console.log(`${i}: expectFeeDueRecipient: ${expectFeeDueRecipient}`);
      console.log(`${i}: expectBalanceOfRecipientAfterTransfer: ${expectBalanceOfRecipientAfterTransfer}`);

      const transfer = await lfi.transfer(recipientAccount, transferAmount, { from: senderAccount });
      const balanceOfSenderAfterTransfer = await lfi.balanceOf(senderAccount);
      const balanceOfRecipientAfterTransfer = await lfi.balanceOf(recipientAccount);

      expectEvent(transfer, "Transfer", {
        from: senderAccount,
        to: recipientAccount,
        value: expectTransferAmount,
      });

      const balanceOfSenderAfterTransferDiff = testUtil.bnAbsDiff(
        balanceOfSenderAfterTransfer,
        expectBalanceOfSenderAfterTransfer
      );
      assert.ok(
        balanceOfSenderAfterTransferDiff.lte(BN_ONE),
        `${i}: Balance of sender after transfer is ${balanceOfSenderAfterTransfer} instead of ${expectBalanceOfSenderAfterTransfer}`
      );

      const balanceOfRecipientAfterTransferDiff = testUtil.bnAbsDiff(
        balanceOfRecipientAfterTransfer,
        expectBalanceOfRecipientAfterTransfer
      );
      assert.ok(
        balanceOfRecipientAfterTransferDiff.lte(BN_ONE),
        `${i}: Balance of recipient after transfer is ${balanceOfRecipientAfterTransfer} instead of ${expectBalanceOfRecipientAfterTransfer}`
      );

      const expectTotalSupplyAfterTransfer = expectInitialTotalSupply;
      const expectReflectionTotalAfterTransfer = currentReflectionTotalBeforeTransfer.sub(expectGetValueReflectionFee);
      const expectROwnedOfSenderAfterTransfer = expectROwnedOfSenderBeforeTransfer.sub(expectGetValueReflectionAmount);
      const expectTOwnedOfSenderAfterTransfer = BN_ZERO;
      const expectROwnedOfRecipientAfterTransfer = expectROwnedOfRecipientBeforeTransfer.add(
        expectGetValueReflectionTransferAmount
      );
      const expectTOwnedOfRecipientAfterTransfer = BN_ZERO;
      const expectTokenFromReflectionOfSenderAfterTransfer = expectBalanceOfSenderAfterTransfer;
      const expectTokenFromReflectionOfRecipientAfterTransfer = expectBalanceOfRecipientAfterTransfer;

      console.log(`${i}: expectGetValueReflectionAmount: ${expectGetValueReflectionAmount}`);
      console.log(`${i}: expectROwnedOfSenderAfterTransfer: ${expectROwnedOfSenderAfterTransfer}`);

      const totalSupplyAfterTransfer = await lfi.totalSupply();
      const reflectionTotalAfterTransfer = await lfi.rTotal();
      const rOwnedOfSenderAfterTransfer = await lfi.rOwned(senderAccount);
      const tOwnedOfSenderAfterTransfer = await lfi.tOwned(senderAccount);
      const rOwnedOfRecipientAfterTransfer = await lfi.rOwned(recipientAccount);
      const tOwnedOfRecipientAfterTransfer = await lfi.tOwned(recipientAccount);
      const tokenFromReflectionOfSenderAfterTransfer = await lfi.tokenFromReflection(expectROwnedOfSenderAfterTransfer);
      const tokenFromReflectionOfRecipientAfterTransfer = await lfi.tokenFromReflection(
        expectROwnedOfRecipientAfterTransfer
      );

      assert.ok(
        totalSupplyAfterTransfer.eq(expectTotalSupplyAfterTransfer),
        `${i}: Total supply after transfer is ${totalSupplyAfterTransfer} instead of ${expectTotalSupplyAfterTransfer}`
      );

      assert.ok(
        reflectionTotalAfterTransfer.eq(expectReflectionTotalAfterTransfer),
        `${i}: Reflection total after transfer is ${reflectionTotalAfterTransfer} instead of ${expectReflectionTotalAfterTransfer}`
      );

      assert.ok(
        rOwnedOfSenderAfterTransfer.eq(expectROwnedOfSenderAfterTransfer),
        `${i}: rOwned of sender after transfer is ${rOwnedOfSenderAfterTransfer} instead of ${expectROwnedOfSenderAfterTransfer}`
      );

      assert.ok(
        tOwnedOfSenderAfterTransfer.eq(expectTOwnedOfSenderAfterTransfer),
        `${i}: tOwned of sender after transfer is ${tOwnedOfSenderAfterTransfer} instead of ${expectTOwnedOfSenderAfterTransfer}`
      );

      assert.ok(
        rOwnedOfRecipientAfterTransfer.eq(expectROwnedOfRecipientAfterTransfer),
        `${i}: rOwned of recipient after transfer is ${rOwnedOfRecipientAfterTransfer} instead of ${expectROwnedOfRecipientAfterTransfer}`
      );

      assert.ok(
        tOwnedOfRecipientAfterTransfer.eq(expectTOwnedOfRecipientAfterTransfer),
        `${i}: tOwned of recipient after transfer is ${tOwnedOfRecipientAfterTransfer} instead of ${expectTOwnedOfRecipientAfterTransfer}`
      );

      const tokenFromReflectionOfSenderAfterTransferDiff = testUtil.bnAbsDiff(
        tokenFromReflectionOfSenderAfterTransfer,
        expectTokenFromReflectionOfSenderAfterTransfer
      );
      assert.ok(
        tokenFromReflectionOfSenderAfterTransferDiff.lte(BN_ONE),
        `${i}: Token from reflection of sender after transfer is ${tokenFromReflectionOfSenderAfterTransfer} instead of ${expectTokenFromReflectionOfSenderAfterTransfer}`
      );

      const tokenFromReflectionOfRecipientAfterTransferDiff = testUtil.bnAbsDiff(
        tokenFromReflectionOfRecipientAfterTransfer,
        expectTokenFromReflectionOfRecipientAfterTransfer
      );
      assert.ok(
        tokenFromReflectionOfRecipientAfterTransferDiff.lte(BN_ONE),
        `${i}: Token from reflection of recipient after transfer is ${tokenFromReflectionOfRecipientAfterTransfer} instead of ${expectTokenFromReflectionOfRecipientAfterTransfer}`
      );

      const expectCurrentReflectionSupplyAfterTransfer = expectReflectionTotalAfterTransfer;
      const expectCurrentTokenSupplyAfterTransfer = expectTotalSupplyAfterTransfer;
      const expectRateAfterTransfer = expectCurrentReflectionSupplyAfterTransfer.div(
        expectCurrentTokenSupplyAfterTransfer
      );
      const expectTotalFeesAfterTransfer = currentTotalFeesBeforeTransfer.add(expectTransactionFee);

      console.log(`${i}: expectCurrentReflectionSupplyAfterTransfer: ${expectCurrentReflectionSupplyAfterTransfer}`);
      console.log(`${i}: expectCurrentTokenSupplyAfterTransfer: ${expectCurrentTokenSupplyAfterTransfer}`);
      console.log(`${i}: expectRateAfterTransfer: ${expectRateAfterTransfer}`);

      const totalFeesAfterTransfer = await lfi.totalFees();

      assert.ok(
        totalFeesAfterTransfer.eq(expectTotalFeesAfterTransfer),
        `${i}: Total fees after transfer is ${totalFeesAfterTransfer} instead of ${expectTotalFeesAfterTransfer}`
      );

      currentReflectionTotalBeforeTransfer = currentReflectionTotalBeforeTransfer.sub(expectGetValueReflectionFee);
      currentTotalFeesBeforeTransfer = currentTotalFeesBeforeTransfer.add(expectTransactionFee);
    }
  });

  it("should transfer correctly between different accounts", async () => {
    const normalAccount1 = defaultTeamAccount;
    const normalAccount2 = accounts[5];
    const excludedAccount1 = accounts[6];
    const excludedAccount2 = accounts[7];
    const dynamicAccount1 = accounts[8];
    const dynamicAccount2 = accounts[9];

    await lfi.excludeAccount(excludedAccount1);
    await lfi.excludeAccount(excludedAccount2);
    await lfi.excludeAccount(dynamicAccount1);

    let transferUnits = [
      // Normal -> Normal
      {
        sender: normalAccount1,
        recipient: normalAccount2,
        amount: ether("619"),
      },
      {
        sender: normalAccount2,
        recipient: normalAccount1,
        amount: wei("997"),
      },
      // Normal -> Excluded
      {
        sender: normalAccount1,
        recipient: excludedAccount1,
        amount: ether("617"),
      },
      {
        sender: normalAccount1,
        recipient: excludedAccount2,
        amount: wei("991"),
      },
      // Normal -> Dynamic (normal <-> excluded)
      {
        sender: normalAccount1,
        recipient: dynamicAccount2,
        amount: ether("613"),
      },
      {
        sender: normalAccount1,
        recipient: dynamicAccount2,
        amount: wei("983"),
      },
      // Normal -> Dynamic (excluded <-> normal)
      {
        sender: normalAccount1,
        recipient: dynamicAccount1,
        amount: ether("607"),
      },
      {
        sender: normalAccount1,
        recipient: dynamicAccount1,
        amount: wei("607"),
      },
      // Excluded -> Normal
      {
        sender: excludedAccount1,
        recipient: normalAccount1,
        amount: ether("97"),
      },
      {
        sender: excludedAccount1,
        recipient: normalAccount1,
        amount: wei("977"),
      },
      // Excluded -> Excluded
      {
        sender: excludedAccount1,
        recipient: excludedAccount2,
        amount: ether("89"),
      },
      {
        sender: excludedAccount2,
        recipient: excludedAccount1,
        amount: wei("971"),
      },
      // Excluded -> Dynamic (normal <-> excluded)
      {
        sender: excludedAccount1,
        recipient: dynamicAccount2,
        amount: ether("83"),
      },
      {
        sender: excludedAccount1,
        recipient: dynamicAccount2,
        amount: wei("967"),
      },
      // Excluded -> Dynamic (excluded <-> normal)
      {
        sender: excludedAccount1,
        recipient: dynamicAccount1,
        amount: ether("79"),
      },
      {
        sender: excludedAccount1,
        recipient: dynamicAccount1,
        amount: wei("953"),
      },
      // Dynamic (normal <-> excluded) -> Normal
      {
        sender: dynamicAccount1,
        recipient: normalAccount1,
        amount: ether("73"),
      },
      {
        sender: dynamicAccount1,
        recipient: normalAccount2,
        amount: wei("947"),
      },
      // Dynamic (normal <-> excluded) -> Excluded
      {
        sender: dynamicAccount1,
        recipient: excludedAccount1,
        amount: ether("71"),
      },
      {
        sender: dynamicAccount1,
        recipient: excludedAccount2,
        amount: wei("941"),
      },
      // Dynamic (normal <-> excluded) -> Dynamic (excluded <-> normal)
      {
        sender: dynamicAccount1,
        recipient: dynamicAccount2,
        amount: ether("67"),
      },
      {
        sender: dynamicAccount1,
        recipient: dynamicAccount2,
        amount: wei("937"),
      },
      // Dynamic (excluded <-> normal) -> Normal
      {
        sender: dynamicAccount2,
        recipient: normalAccount1,
        amount: ether("61"),
      },
      {
        sender: dynamicAccount2,
        recipient: normalAccount2,
        amount: wei("929"),
      },
      // Dynamic (excluded <-> normal) -> Excluded
      {
        sender: dynamicAccount2,
        recipient: excludedAccount1,
        amount: ether("59"),
      },
      {
        sender: dynamicAccount2,
        recipient: excludedAccount2,
        amount: wei("919"),
      },
      // Dynamic (excluded <-> normal) -> Dynamic (normal <-> excluded)
      {
        sender: dynamicAccount2,
        recipient: dynamicAccount1,
        amount: ether("53"),
      },
      {
        sender: dynamicAccount2,
        recipient: dynamicAccount1,
        amount: wei("911"),
      },
    ];

    let toggledTimes = 0; // 0: original state, 1: another state, 2: original state, 3: another state
    do {
      for (let i = 0; i < transferUnits.length; i++) {
        let transferInfo = transferUnits[i];
        const expectedBalanceAfterTransfer = await testUtil.estimateLfiBalanceAfterTransfer(
          lfi,
          transferInfo.sender,
          transferInfo.recipient,
          transferInfo.amount
        );
        await lfi.transfer(transferInfo.recipient, transferInfo.amount, { from: transferInfo.sender });
        const actualBalanceOfSenderAfterTransfer = await lfi.balanceOf(transferInfo.sender);
        const actualBalanceOfRecipientAfterTransfer = await lfi.balanceOf(transferInfo.recipient);

        assert.ok(
          testUtil.bnDiffInRange(actualBalanceOfSenderAfterTransfer, expectedBalanceAfterTransfer.sender, BN_ONE),
          `Sender's balance ${actualBalanceOfSenderAfterTransfer} is not close to ${actualBalanceOfSenderAfterTransfer.sender}`
        );
        assert.ok(
          testUtil.bnDiffInRange(actualBalanceOfRecipientAfterTransfer, expectedBalanceAfterTransfer.recipient, BN_ONE),
          `Recipient's balance ${actualBalanceOfSenderAfterTransfer} is not close to ${actualBalanceOfSenderAfterTransfer.recipient}`
        );
      }

      /* Toggle dynamic accounts */
      const dynamicAccounts = [dynamicAccount1, dynamicAccount2];
      for (let j = 0; j < dynamicAccounts.length; j++) {
        const dynamicAccount = dynamicAccounts[j];
        if (await lfi.isExcluded(dynamicAccount)) {
          await lfi.includeAccount(dynamicAccount);
        } else {
          await lfi.excludeAccount(dynamicAccount);
        }
      }
      toggledTimes++;
    } while (toggledTimes <= 3);
  });

  it("should not allow the amount bigger than total supply for reflectionFromToken", async () => {
    const totalSupply = await lfi.totalSupply();

    await expectRevert(lfi.reflectionFromToken(totalSupply.add(BN_ONE), true), "Amount must be less than supply");
    await expectRevert(lfi.reflectionFromToken(totalSupply.add(BN_ONE), false), "Amount must be less than supply");
  });

  it("should be interchangeable for reflectionFromToken and tokenFromReflection", async () => {
    const originalAmount = ether("1");

    const reflection = await lfi.reflectionFromToken(originalAmount, false);
    const actualAmount = await lfi.tokenFromReflection(reflection);

    assert.ok(testUtil.bnDiffInRange(actualAmount, originalAmount, BN_ONE));
  });
});
