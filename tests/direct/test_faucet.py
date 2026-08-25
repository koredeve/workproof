import time

U = int


def _deploy(direct_vm, direct_deploy, who):
    direct_vm.sender = who
    return direct_deploy("contracts/WorkFaucet.py")


def _deposit(direct_vm, contract, owner, amount):
    direct_vm.sender = owner
    direct_vm.value = amount
    contract.deposit()
    direct_vm.value = 0


def test_claim_pays_and_enforces_cooldown(direct_vm, direct_deploy, direct_alice, direct_bob):
    """A user claims once; a second claim inside the cooldown reverts; after it passes, they claim again."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _deposit(direct_vm, contract, direct_alice, 5 * 10**18)

    with direct_vm.prank(direct_bob):
        contract.claim()
    assert contract.faucet_info()["claim_count"] == 1

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("already claimed this week"):
            contract.claim()

    # owner shortens the cooldown to prove the window opens again
    contract.set_config(U(10**17), U(2))
    time.sleep(3)
    with direct_vm.prank(direct_bob):
        contract.claim()

    info = contract.faucet_info()
    assert info["claim_count"] == 2


def test_claim_amount_is_exact(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Each claim drops exactly the configured 0.6 GEN."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _deposit(direct_vm, contract, direct_alice, 2 * 10**18)

    with direct_vm.prank(direct_bob):
        contract.claim()

    info = contract.faucet_info()
    assert info["total_dropped"] == 6 * 10**17
    assert info["balance"] == 14 * 10**17


def test_empty_faucet_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    """No claims when the faucet has no funds."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("faucet is empty"):
            contract.claim()


def test_deposit_requires_value(direct_vm, direct_deploy, direct_alice):
    """Depositing nothing reverts."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    with direct_vm.expect_revert("Send GEN"):
        contract.deposit()


def test_owner_config_and_guards(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Only the owner configures the faucet; zero values rejected; only owner withdraws."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _deposit(direct_vm, contract, direct_alice, 10**18)

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("Only the faucet owner"):
            contract.set_config(U(10**17), U(60))
    with direct_vm.expect_revert("greater than zero"):
        contract.set_config(U(0), U(60))

    contract.set_config(U(10**17), U(2))
    with direct_vm.prank(direct_bob):
        contract.claim()

    time.sleep(3)
    with direct_vm.prank(direct_bob):
        contract.claim()

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("Only the faucet owner"):
            contract.withdraw_owner(U(8 * 10**17))
    contract.withdraw_owner(U(8 * 10**17))
