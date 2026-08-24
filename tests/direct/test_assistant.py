import json


def test_draft_criteria_stores_structured_draft(direct_vm, direct_deploy, direct_alice):
    """A prose brief becomes a reviewable structured draft on-chain."""
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/CriteriaAssistant.py")
    direct_vm.mock_llm(
        r"structured work contract draft",
        json.dumps({
            "title": "Build a responsive landing page",
            "description": "Deliver a deployed landing page with hero, pricing and contact form.",
            "criteria": [
                "Landing page is publicly accessible",
                "Hero section present",
                "Pricing section present",
                "Contact form validates input",
            ],
            "deadline_hint": "7 days",
        }),
    )
    contract.draft_criteria("req-1", "I need a dev to build a responsive landing page with hero, pricing and contact form, deployed within seven days.")

    d = contract.get_draft("req-1")
    assert d["title"] == "Build a responsive landing page"
    criteria = json.loads(d["criteria"])
    assert len(criteria) == 4
    assert "publicly accessible" in criteria[0]
    assert d["deadline_hint"] == "7 days"


def test_duplicate_request_id_rejected(direct_vm, direct_deploy, direct_alice):
    """The same request id cannot be drafted twice."""
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/CriteriaAssistant.py")
    direct_vm.mock_llm(
        r"structured work contract draft",
        json.dumps({"title": "T", "description": "D", "criteria": ["c1"], "deadline_hint": ""}),
    )
    contract.draft_criteria("req-1", "brief")
    with direct_vm.expect_revert("already used"):
        contract.draft_criteria("req-1", "brief again")


def test_malformed_llm_raises_and_nothing_stored(direct_vm, direct_deploy, direct_alice):
    """Garbage output raises [LLM_ERROR]; no draft is stored."""
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/CriteriaAssistant.py")
    direct_vm.mock_llm(r"structured work contract draft", "sorry, no")
    with direct_vm.expect_revert("[LLM_ERROR]"):
        contract.draft_criteria("req-1", "brief")
    with direct_vm.expect_revert("Unknown request id"):
        contract.get_draft("req-1")
