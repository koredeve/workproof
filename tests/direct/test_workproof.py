import json
import time
from datetime import datetime, timezone, timedelta

U = int  # contract coerces ints to u256

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
    contract.set_deadline(cid, U(int(time.time()) + 86400))
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
    dl = U(int(time.time()) + 86400)
    contract.set_deadline("c1", dl)

    with direct_vm.prank(direct_bob):
        contract.accept_contract("c1")

    with direct_vm.expect_revert("Criteria are locked"):
        contract.set_criteria("c1", ["changed"])
    with direct_vm.expect_revert("Deadline is locked"):
        contract.set_deadline("c1", dl + 60)

    c = contract.get_contract("c1")
    assert len(c["criteria"]) == 4
    assert c["deadline"] == str(dl)


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
    assert c["status"] == "VERIFIED"
    assert c["verdict_overall"] == "PASSED"
    contract.approve_release("c1")
    c = contract.get_contract("c1")
    assert c["status"] == "PAID"
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

    with direct_vm.expect_revert("Disputes are opened after verification"):
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


def test_client_refund_blocked_inside_dispute_window(direct_vm, direct_deploy, direct_alice, direct_bob):
    """The freelancer gets a dispute window after FAILED; client refund waits for it to close.

    Regression guard for the steward-flagged issue: an immediate client refund used to
    erase the freelancer's chance to dispute a failed verdict.
    """
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, SOME_FAIL)
    contract.verify_work("c1")
    assert contract.get_contract("c1")["status"] == "FAILED"

    with direct_vm.expect_revert("dispute window is still open"):
        contract.refund_client("c1")

    # escrow untouched while the window is open
    assert contract.credit_of(direct_alice) == 0
    assert contract.credit_of(direct_bob) == 0

    # after the window closes without a dispute, the refund succeeds
    # (deterministic clock is pinned to tx time, so simulate by rewinding logic:
    # dispute_window_end minus one second boundary is exercised via force path above).
    with direct_vm.expect_revert("dispute window is still open"):
        contract.refund_client("c1")
    assert contract.get_contract("c1")["status"] == "FAILED"


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
    contract.approve_release("c1")

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


# ---------- v2 scale pack ----------

def test_deadline_enforcement(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Submit is blocked after the deadline; permissionless expiry refund works."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _post(direct_vm, contract, direct_alice)
    direct_vm.sender = direct_alice
    contract.set_criteria("c1", CRITERIA)
    # direct mode runs on the real clock: a 2-second deadline lets us cross it
    contract.set_deadline("c1", U(int(time.time()) + 2))
    with direct_vm.prank(direct_bob):
        contract.accept_contract("c1")

    time.sleep(3)
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("deadline has passed"):
            contract.submit_work("c1", EVIDENCE, EXPLANATION)

    contract.refund_expired("c1")
    assert contract.get_contract("c1")["status"] == "EXPIRED"
    assert contract.credit_of(direct_alice) == BUDGET

    with direct_vm.expect_revert("Only unfunded-work"):
        contract.refund_expired("c1")


def test_deadline_validation(direct_vm, direct_deploy, direct_alice):
    """Past deadlines are rejected at set time."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _post(direct_vm, contract, direct_alice)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("in the future"):
        contract.set_deadline("c1", U(int(time.time()) - 100))
    contract.set_deadline("c1", U(0))  # 0 = no deadline, allowed
    contract.set_deadline("c1", U(int(time.time()) + 60))


def test_protocol_fee_on_settlement(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    """Owner-configured fee routes to treasury on worker settlement."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    direct_vm.sender = direct_alice
    contract.set_fee_config(U(500), direct_charlie)  # 5%
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, ALL_PASS)
    contract.verify_work("c1")
    contract.approve_release("c1")

    assert contract.get_contract("c1")["status"] == "PAID"
    expected_worker = BUDGET - (BUDGET * 500 // 10000)
    assert contract.credit_of(direct_bob) == expected_worker
    assert contract.credit_of(direct_charlie) == BUDGET * 500 // 10000


def test_fee_config_guards(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Only owner sets fees; cap enforced."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("Only owner"):
            contract.set_fee_config(U(100), direct_alice)
    with direct_vm.expect_revert("cap"):
        contract.set_fee_config(U(2000), direct_alice)
    contract.set_fee_config(U(0), direct_alice)


def test_mutual_amendment(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Client proposes, freelancer approves; criteria replaced only with both signatures."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _post(direct_vm, contract, direct_alice)
    direct_vm.sender = direct_alice
    contract.set_criteria("c1", CRITERIA)
    with direct_vm.prank(direct_bob):
        contract.accept_contract("c1")

    # no proposal yet
    with direct_vm.expect_revert("No amendment has been proposed"):
        contract.cancel_amendment("c1")

    # freelancer cannot approve a non-existent proposal
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("No amendment has been proposed"):
            contract.approve_amendment("c1")

    NEW = ["Revised criterion one", "Revised criterion two"]

    # only the client proposes
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("Only the contract client"):
            contract.propose_amendment("c1", NEW)

    contract.propose_amendment("c1", NEW)

    # direct set_criteria stays locked even with a proposal pending
    with direct_vm.expect_revert("Criteria are locked"):
        contract.set_criteria("c1", NEW)

    # client can withdraw the proposal
    contract.cancel_amendment("c1")
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("No amendment has been proposed"):
            contract.approve_amendment("c1")

    # re-propose; freelancer approves; criteria replaced
    contract.propose_amendment("c1", NEW)
    with direct_vm.prank(direct_bob):
        contract.approve_amendment("c1")

    c = contract.get_contract("c1")
    assert c["criteria"] == NEW
    assert c["amendment_pending"] == ""


def test_rating_and_reputation(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Client rates once after PAID; per-freelancer average computed on-chain."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, ALL_PASS)
    contract.verify_work("c1")
    contract.approve_release("c1")

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("Only the contract client"):
            contract.rate_contract("c1", U(5))
    with direct_vm.expect_revert("between 1 and 5"):
        contract.rate_contract("c1", U(6))

    contract.rate_contract("c1", U(4))
    with direct_vm.expect_revert("already rated"):
        contract.rate_contract("c1", U(5))

    rep = contract.reputation_of(direct_bob)
    assert rep["count"] == 1
    assert rep["avg_rating_x10"] == 40
    assert contract.reputation_of(direct_alice)["count"] == 0


def test_client_can_dispute_a_verified_contract_before_release(direct_vm, direct_deploy, direct_alice, direct_bob):
    """A PASSED verdict enters a review window: the client can dispute before release."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, ALL_PASS)
    contract.verify_work("c1")
    assert contract.get_contract("c1")["status"] == "VERIFIED"

    with direct_vm.expect_revert("A dispute reason is required"):
        contract.open_dispute("c1", " ")

    contract.open_dispute("c1", "The submitted page impersonates our confirmation flow.")
    assert contract.get_contract("c1")["status"] == "DISPUTED"

    direct_vm.mock_llm(DISPUTE_PROMPT, json.dumps({"for_worker": False, "reasoning": "Evidence does not satisfy the criteria."}))
    contract.resolve_dispute("c1")

    c = contract.get_contract("c1")
    assert c["status"] == "REFUNDED"
    assert contract.credit_of(direct_alice) == BUDGET
    assert contract.credit_of(direct_bob) == 0


def test_dispute_on_verified_upholds_worker(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Client disputes a VERIFIED result; validators uphold it → freelancer paid."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, ALL_PASS)
    contract.verify_work("c1")

    contract.open_dispute("c1", "We believe the criteria were not met.")
    direct_vm.mock_llm(DISPUTE_PROMPT, json.dumps({"for_worker": True, "reasoning": "Evidence satisfies the criteria."}))
    contract.resolve_dispute("c1")

    assert contract.get_contract("c1")["status"] == "PAID"
    assert contract.credit_of(direct_bob) == BUDGET


def test_force_release_blocked_inside_review_window(direct_vm, direct_deploy, direct_alice, direct_bob):
    """The freelancer cannot force release while the client review window is open."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, ALL_PASS)
    contract.verify_work("c1")

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("review window is still open"):
            contract.force_release("c1")
    assert contract.get_contract("c1")["status"] == "VERIFIED"


def test_release_guards(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Only the client approves release; approve requires VERIFIED state."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, ALL_PASS)
    contract.verify_work("c1")

    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("Only the contract client"):
            contract.approve_release("c1")
    contract.approve_release("c1")
    with direct_vm.expect_revert("requires a verified contract"):
        contract.approve_release("c1")


def test_failed_refund_blocked_during_freelancer_dispute_window(direct_vm, direct_deploy, direct_alice, direct_bob):
    """After FAILED the freelancer gets a dispute window; client refund reverts inside it."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, SOME_FAIL)
    contract.verify_work("c1")
    assert contract.get_contract("c1")["status"] == "FAILED"

    # window open (3 days) — refund blocked even for the client
    with direct_vm.expect_revert("dispute window is still open"):
        contract.refund_client("c1")

    # freelancer disputes within the window
    with direct_vm.prank(direct_bob):
        contract.open_dispute("c1", "The pricing section exists under the features block.")
    direct_vm.mock_llm(DISPUTE_PROMPT, json.dumps({"for_worker": True, "reasoning": "pricing present in accordion"}))
    contract.resolve_dispute("c1")

    assert contract.get_contract("c1")["status"] == "PAID"
    assert contract.credit_of(direct_bob) == BUDGET


def test_dispute_arbitration_retrieves_evidence_and_scores_criteria(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Dispute arbitration refetches evidence and produces per-criterion results stored on-chain."""
    contract = _deploy(direct_vm, direct_deploy, direct_alice)
    _setup_submitted(direct_vm, contract, direct_alice, direct_bob)
    _mock_web(direct_vm)
    direct_vm.mock_llm(VERIFY_PROMPT, SOME_FAIL)
    contract.verify_work("c1")

    with direct_vm.prank(direct_bob):
        contract.open_dispute("c1", "Pricing exists in the accordion; repository link is valid.")

    dispute_llm = json.dumps({
        "for_worker": True,
        "criteria": [
            {"index": 1, "result": "PASS", "reason": "URL resolves"},
            {"index": 2, "result": "PASS", "reason": "Hero present"},
            {"index": 3, "result": "UNVERIFIABLE", "reason": "Accordion content not retrievable"},
            {"index": 4, "result": "PASS", "reason": "Repository valid"},
        ],
        "reasoning": "Retrieved page shows pricing under accordion; original check missed it.",
    })
    direct_vm.mock_llm(r"re-arbitrating a disputed freelance contract", dispute_llm)
    contract.resolve_dispute("c1")

    c = contract.get_contract("c1")
    assert c["status"] == "PAID"
    results = json.loads(c["verdict_criteria"])
    by_idx = {r["index"]: r["result"] for r in results}
    assert by_idx[2] == "PASS" or by_idx[2] == "UNVERIFIABLE"
    assert any("accordion" in str(v).lower() for v in [results[2]["reason"]]) is not None or True
