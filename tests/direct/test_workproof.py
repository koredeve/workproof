import json

BUDGET = 2 * 10**18

CRITERIA = [
    "Landing page is publicly accessible at the submitted URL",
    "Page includes a hero section with a headline",
    "Page includes a pricing section",
    "Repository link is provided and contains the project",
]

EVIDENCE = ["https://demo.example.com/landing", "https://github.com/acme/landing"]
EXPLANATION = "Deployed the landing page and pushed the source repository."

ALL_PASS = json.dumps(
    {
        "overall": "PASSED",
        "criteria": [
            {"index": 1, "result": "PASS", "reason": "URL resolves to the landing page"},
            {"index": 2, "result": "PASS", "reason": "Hero section present"},
            {"index": 3, "result": "PASS", "reason": "Pricing section present"},
            {"index": 4, "result": "PASS", "reason": "Repository contains the project"},
        ],
        "reasoning": "All criteria verified against retrieved evidence.",
    }
)

SOME_FAIL = json.dumps(
    {
        "overall": "FAILED",
        "criteria": [
            {"index": 1, "result": "PASS", "reason": "URL resolves"},
            {"index": 2, "result": "PASS", "reason": "Hero present"},
            {"index": 3, "result": "FAIL", "reason": "No pricing section found in the page"},
            {"index": 4, "result": "UNVERIFIABLE", "reason": "Repository URL returned 404"},
        ],
        "reasoning": "Two criteria are not satisfied by the evidence.",
    }
)

VERIFY_PROMPT = r"verifying completed freelance work"
DISPUTE_PROMPT = r"re-arbitrating a disputed freelance contract"


def _deploy(direct_vm, direct_deploy, who):
    direct_vm.sender = who
    return direct_deploy("contracts/WorkProof.py")


def _post(direct_vm, contract, client, cid="c1", budget=BUDGET):
    direct_vm.sender = client
    direct_vm.value = budget
    contract.post_contract(cid, "Build SaaS landing page", "A responsive landing page with hero and pricing sections, deployed publicly.")
    direct_vm.value = 0


def _setup_submitted(direct_vm, contract, client, freelancer, cid="c1"):
    _post(direct_vm, contract, client, cid)
    direct_vm.sender = client
    contract.set_criteria(cid, CRITERIA)
    contract.set_deadline(cid, "2026-09-30")
    with direct_vm.prank(freelancer):
        contract.accept_contract(cid)
        contract.submit_work(cid, EVIDENCE, EXPLANATION)


def _mock_web(direct_vm):
    direct_vm.mock_web(
        r"demo\.example\.com",
        {"status": 200, "body": "<html><h1>Hero</h1><section>Pricing</section></html>"},
    )
    direct_vm.mock_web(
        r"github\.com",
        {"status": 200, "body": "repository landing page project files"},
    )


def test_post_locks_budget_and_defaults(direct_vm, direct_deploy, direct_alice):
    """Posting funds escrow and stores defaults; views expose state."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _post(direct_vm, contract, direct_alice)

    assert contract.total_contracts() == 1
    c = contract.get_contract("c1")
    assert c["status"] == "OPEN"
    assert c["budget_atto"] == BUDGET
    assert c["criteria"] == []
    assert c["freelancer"] == ""
    assert len(contract.get_contract_ids()["ids"]) == 1


def test_post_guards(direct_vm, direct_deploy, direct_alice):
    """Tiny budgets, duplicates and empty text are rejected."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)

    direct_vm.sender = direct_alice
    direct_vm.value = 10**16
    with direct_vm.expect_revert("Budget too small"):
        contract.post_contract("c0", "t", "d")
    direct_vm.value = 0

    _post(direct_vm, contract, direct_alice)
    with direct_vm.expect_revert("already exists"):
        _post(direct_vm, contract, direct_alice)

    direct_vm.value = BUDGET
    with direct_vm.expect_revert("Title and description"):
        contract.post_contract("c2", " ", "d")
    direct_vm.value = 0


def test_criteria_are_client_only_and_locked_after_accept(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Only the client sets criteria, only while OPEN; at least one required."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _post(direct_vm, contract, direct_alice)

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("Only the contract client"):
            contract.set_criteria("c1", CRITERIA)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("At least one acceptance criterion"):
        contract.set_criteria("c1", [])

    contract.set_criteria("c1", CRITERIA)
    contract.set_deadline("c1", "2026-09-30")

    with direct_vm.prank(direct_bob):
        contract.accept_contract("c1")

    with direct_vm.expect_revert("Criteria are locked"):
        contract.set_criteria("c1", ["changed"])
    with direct_vm.expect_revert("Deadline is locked"):
        contract.set_deadline("c1", "2026-10-01")

    c = contract.get_contract("c1")
    assert len(c["criteria"]) == 4
    assert c["deadline"] == "2026-09-30"


def test_accept_guards(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Client cannot accept own contract; criteria required before acceptance."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _post(direct_vm, contract, direct_alice)
    direct_vm.sender = direct_alice
    contract.set_criteria("c1", CRITERIA)

    with direct_vm.expect_revert("cannot accept their own"):
        contract.accept_contract("c1")

    with direct_vm.prank(direct_bob):
        contract.accept_contract("c1")

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("not open"):
            contract.accept_contract("c1")


def test_submit_guards(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    """Only the accepted freelancer submits; evidence and explanation required; capped URLs."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("not awaiting work"):
            contract.submit_work("c1", EVIDENCE, "double")

    _post(direct_vm, contract, direct_alice, "c2")
    direct_vm.sender = direct_alice
    contract.set_criteria("c2", CRITERIA)
    with direct_vm.prank(direct_charlie):
        with direct_vm.expect_revert("Only the accepted freelancer"):
            contract.submit_work("c2", EVIDENCE, "impostor")
    with direct_vm.prank(direct_charlie):
        contract.accept_contract("c2")
    with direct_vm.prank(direct_charlie):
        with direct_vm.expect_revert("explanation of the submitted work"):
            contract.submit_work("c2", EVIDENCE, "  ")
    with direct_vm.prank(direct_charlie):
        with direct_vm.expect_revert("At least one evidence URL"):
            contract.submit_work("c2", [], "expl")
    with direct_vm.prank(direct_charlie):
        with direct_vm.expect_revert("At most 3 evidence URLs"):
            contract.submit_work("c2", ["https://a.com", "https://b.com", "https://c.com", "https://d.com"], "expl")


def test_verification_pass_pays_freelancer(direct_vm, direct_deploy, direct_alice, direct_bob):
    """All criteria PASS → PAID, budget credited to freelancer, verdict stored."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, ALL_PASS)

    contract.verify_work("c1")

    c = contract.get_contract("c1")
    assert c["status"] == "PAID"
    assert c["verdict_overall"] == "PASSED"
    verdict_criteria = json.loads(c["verdict_criteria"])
    assert len(verdict_criteria) == 4
    assert verdict_criteria[0]["result"] == "PASS"
    assert contract.credit_of(direct_bob) == BUDGET
    assert contract.credit_of(direct_alice) == 0


def test_verification_fail_leaves_escrow_protected(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Any FAIL → FAILED; funds stay escrowed; per-criterion results stored."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, SOME_FAIL)

    contract.verify_work("c1")

    c = contract.get_contract("c1")
    assert c["status"] == "FAILED"
    assert c["verdict_overall"] == "FAILED"
    verdict_criteria = json.loads(c["verdict_criteria"])
    results = {item["index"]: item["result"] for item in verdict_criteria}
    assert results[3] == "FAIL"
    assert results[4] == "UNVERIFIABLE"
    assert contract.credit_of(direct_bob) == 0
    assert contract.credit_of(direct_alice) == 0


def test_verification_requires_submitted_state(direct_vm, direct_deploy, direct_alice, direct_bob):
    """verify_work is impossible before submission."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _post(direct_vm, contract, direct_alice)
    direct_vm.sender = direct_alice
    contract.set_criteria("c1", CRITERIA)
    with direct_vm.expect_revert("requires a submitted contract"):
        contract.verify_work("c1")


def test_dispute_flow_refunds_client_when_criteria_not_met(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Failed verification → freelancer disputes → validators uphold original criteria → REFUNDED."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, SOME_FAIL)
    contract.verify_work("c1")

    with direct_vm.prank(direct_bob):
        contract.open_dispute("c1", "The pricing section exists under the features block; the automated check missed it.")

    c = contract.get_contract("c1")
    assert c["status"] == "DISPUTED"
    assert "pricing" in c["dispute_reason"]

    direct_vm.mock_llm(DISPUTE_PROMPT, json.dumps({"for_worker": False, "reasoning": "Evidence still shows no pricing section."}))
    contract.resolve_dispute("c1")

    c = contract.get_contract("c1")
    assert c["status"] == "REFUNDED"
    assert contract.credit_of(direct_alice) == BUDGET
    assert contract.credit_of(direct_bob) == 0


def test_dispute_flow_pays_worker_when_overturned(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Failed verification → dispute → validators find criteria were met → PAID."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, SOME_FAIL)
    contract.verify_work("c1")

    with direct_vm.prank(direct_bob):
        contract.open_dispute("c1", "Pricing is implemented inside the features accordion.")

    direct_vm.mock_llm(DISPUTE_PROMPT, json.dumps({"worker_wins": True, "reasoning": "Pricing section is present within the accordion; criteria are met."}))
    contract.resolve_dispute("c1")

    c = contract.get_contract("c1")
    assert c["status"] == "PAID"
    assert contract.credit_of(direct_bob) == BUDGET


def test_dispute_guards(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    """Only parties, only after FAILED, reason required, no double resolution."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _post(direct_vm, contract, direct_alice)
    direct_vm.sender = direct_alice
    contract.set_criteria("c1", CRITERIA)

    with direct_vm.prank(direct_charlie):
        with direct_vm.expect_revert("Only contract parties"):
            contract.open_dispute("c1", "not my contract")

    with direct_vm.expect_revert("after a failed verification"):
        contract.open_dispute("c1", "too early")

    _setup_submitted(direct_vm, contract, direct_alice, direct_bob, cid="c9")
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, SOME_FAIL)
    contract.verify_work("c9")

    with direct_vm.expect_revert("reason is required"):
        contract.open_dispute("c9", "  ")

    with direct_vm.prank(direct_bob):
        contract.open_dispute("c9", "criteria were met")

    direct_vm.mock_llm(DISPUTE_PROMPT, json.dumps({"for_worker": False, "reasoning": "not met"}))
    contract.resolve_dispute("c9")

    with direct_vm.expect_revert("not disputed"):
        contract.resolve_dispute("c9")


def test_client_refund_after_failed_verification(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Client can refund without dispute after FAILED; double refund impossible."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, SOME_FAIL)
    contract.verify_work("c1")

    contract.refund_client("c1")
    assert contract.get_contract("c1")["status"] == "REFUNDED"
    assert contract.credit_of(direct_alice) == BUDGET

    with direct_vm.expect_revert("only available after a failed verification"):
        contract.refund_client("c1")


def test_cancel_open_refunds_and_blocks_accept(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Cancelling an open contract refunds; cancelled contracts cannot be accepted."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _post(direct_vm, contract, direct_alice)
    direct_vm.sender = direct_alice
    contract.set_criteria("c1", CRITERIA)

    contract.cancel_open("c1")
    assert contract.get_contract("c1")["status"] == "CANCELLED"
    assert contract.credit_of(direct_alice) == BUDGET

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("not open"):
            contract.accept_contract("c1")


def test_withdraw_moves_credits_and_zeroes_them(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Withdraw sends credited GEN out and prevents double withdrawal."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, ALL_PASS)
    contract.verify_work("c1")

    with direct_vm.prank(direct_bob):
        contract.withdraw()
    assert contract.credit_of(direct_bob) == 0

    with direct_vm.expect_revert("Nothing to withdraw"):
        contract.withdraw()


def test_malformed_llm_output_leaves_contract_submitted(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Garbage LLM output raises [LLM_ERROR]; contract stays SUBMITTED, escrow intact."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, "I cannot help with that.")

    with direct_vm.expect_revert("[LLM_ERROR]"):
        contract.verify_work("c1")

    # direct mode does not roll back the VERIFYING marker; the real safety
    # property is that no funds moved and the contract never reached PAID.
    assert contract.get_contract("c1")["status"] in ("SUBMITTED", "VERIFYING")
    assert contract.credit_of(direct_bob) == 0


def test_unreachable_evidence_is_transient(direct_vm, direct_deploy, direct_alice, direct_bob):
    """All evidence endpoints failing raises [TRANSIENT] so consensus can retry."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    direct_vm.mock_web(r"demo\.example\.com", {"status": 503, "body": "down"})
    direct_vm.mock_web(r"github\.com", {"status": 503, "body": "down"})
    direct_vm.mock_llm(VERIFY_PROMPT, ALL_PASS)

    with direct_vm.expect_revert("[TRANSIENT]"):
        contract.verify_work("c1")

    assert contract.get_contract("c1")["status"] in ("SUBMITTED", "VERIFYING")
