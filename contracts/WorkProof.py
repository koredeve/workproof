# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
import json
import time


ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

STATUS_OPEN = "OPEN"
STATUS_ACCEPTED = "ACCEPTED"
STATUS_SUBMITTED = "SUBMITTED"
STATUS_VERIFYING = "VERIFYING"
STATUS_VERIFIED = "VERIFIED"
STATUS_PAID = "PAID"
STATUS_FAILED = "FAILED"
STATUS_DISPUTED = "DISPUTED"
STATUS_REFUNDED = "REFUNDED"
STATUS_CANCELLED = "CANCELLED"
STATUS_EXPIRED = "EXPIRED"

PROTOCOL_FEE_BPS_CAP = 1000  # max 10%

MIN_BUDGET_ATTO = u256(10 ** 17)
FORCE_RELEASE_DELAY_SECONDS = 3 * 24 * 3600  # client review window after VERIFIED
DISPUTE_WINDOW_SECONDS = 3 * 24 * 3600        # freelancer dispute window after FAILED
CLIENT_REVIEW_SECONDS = 3 * 24 * 3600          # client review window after VERIFIED
MAX_EVIDENCE_URLS = 3
EVIDENCE_CHARS = 1500


def _parse_llm_json(text) -> dict:
	import re
	if isinstance(text, dict):
		return text
	s = str(text)
	first = s.find("{")
	last = s.rfind("}")
	if first == -1 or last <= first:
		raise gl.vm.UserError(f"{ERROR_LLM} no JSON object found in LLM output")
	s = s[first : last + 1]
	s = re.sub(r",(?!\s*?[\{\[\"\'\w])", "", s)
	try:
		parsed = json.loads(s)
	except Exception:
		raise gl.vm.UserError(f"{ERROR_LLM} malformed JSON from LLM")
	if not isinstance(parsed, dict):
		raise gl.vm.UserError(f"{ERROR_LLM} non-dict JSON from LLM")
	return parsed


def _handle_leader_error(leaders_res, leader_fn) -> bool:
	leader_msg = leaders_res.message if hasattr(leaders_res, "message") else ""
	try:
		leader_fn()
		return False
	except gl.vm.UserError as e:
		validator_msg = e.message if hasattr(e, "message") else str(e)
		if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(ERROR_EXTERNAL):
			return validator_msg == leader_msg
		if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
			return True
		return False
	except Exception:
		return False


@allow_storage
@dataclass
class Contract:
	client: Address
	freelancer: str
	title: str
	description: str
	criteria: DynArray[str]
	deadline: str
	budget_atto: u256
	status: str
	evidence_urls: DynArray[str]
	explanation: str
	dispute_reason: str
	verdict_overall: str
	verdict_criteria: str
	verdict_reasoning: str
	verified_ts: u256
	amendment_pending: str
	failed_ts: u256
	dispute_window_end: u256
	rating: u256
	rated: bool


class WorkProof(gl.Contract):
	owner_addr: Address
	contracts: TreeMap[str, Contract]
	contract_ids: DynArray[str]
	credits: TreeMap[Address, u256]
	fee_bps: u256
	treasury: Address

	def __init__(self) -> None:
		self.owner_addr = gl.message.sender_address
		self.fee_bps = u256(0)
		self.treasury = gl.message.sender_address

	def _get(self, contract_id: str) -> Contract:
		c = self.contracts.get(contract_id)
		if c is None:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown contract id")
		return c

	def _require_client(self, c: Contract) -> None:
		if str(gl.message.sender_address) != str(c.client):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the contract client may call this")

	@gl.public.view
	def owner(self) -> str:
		return str(self.owner_addr)

	@gl.public.view
	def total_contracts(self) -> u256:
		return u256(len(self.contract_ids))

	@gl.public.view
	def get_contract_ids(self) -> dict:
		ids = []
		for i in range(len(self.contract_ids)):
			ids.append(str(self.contract_ids[i]))
		return {"ids": ids}

	@gl.public.write.payable
	def post_contract(self, contract_id: str, title: str, description: str) -> None:
		if gl.message.value < MIN_BUDGET_ATTO:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Budget too small (min 0.1 GEN)")
		if contract_id in self.contracts:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract id already exists")
		if not title.strip() or not description.strip():
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Title and description are required")
		self.contracts[contract_id] = Contract(
			client=gl.message.sender_address,
			freelancer="",
			title=title,
			description=description,
			criteria=[],
			deadline="",
			budget_atto=u256(gl.message.value),
			status=STATUS_OPEN,
			evidence_urls=[],
			explanation="",
			dispute_reason="",
			verdict_overall="",
			verdict_criteria="",
			verdict_reasoning="",
			verified_ts=u256(0),
			amendment_pending="",
			failed_ts=u256(0),
			dispute_window_end=u256(0),
			rating=u256(0),
			rated=False,
		)
		self.contract_ids.append(contract_id)

	@gl.public.write
	def set_criteria(self, contract_id: str, criteria: DynArray[str]) -> None:
		c = self._get(contract_id)
		self._require_client(c)
		if c.status != STATUS_OPEN:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Criteria are locked after a freelancer accepts")
		if len(criteria) < 1:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} At least one acceptance criterion is required")
		for i in range(len(criteria)):
			c.criteria.append(str(criteria[i]))

	@gl.public.write
	def set_deadline(self, contract_id: str, deadline_ts: u256) -> None:
		c = self._get(contract_id)
		self._require_client(c)
		if c.status != STATUS_OPEN:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Deadline is locked after a freelancer accepts")
		if deadline_ts != u256(0) and deadline_ts <= u256(int(time.time())):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Deadline must be in the future")
		c.deadline = str(deadline_ts)

	@gl.public.write
	def accept_contract(self, contract_id: str) -> None:
		c = self._get(contract_id)
		if c.status != STATUS_OPEN:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract is not open")
		if len(c.criteria) == 0:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Client must define acceptance criteria first")
		if str(gl.message.sender_address) == str(c.client):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} The client cannot accept their own contract")
		c.freelancer = str(gl.message.sender_address)
		c.status = STATUS_ACCEPTED

	@gl.public.write
	def submit_work(self, contract_id: str, evidence_urls: DynArray[str], explanation: str) -> None:
		c = self._get(contract_id)
		if str(gl.message.sender_address) != c.freelancer:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the accepted freelancer may submit")
		if c.status != STATUS_ACCEPTED:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract is not awaiting work")
		if not explanation.strip():
			raise gl.vm.UserError(f"{ERROR_EXPECTED} An explanation of the submitted work is required")
		if len(evidence_urls) == 0:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} At least one evidence URL is required")
		if len(evidence_urls) > MAX_EVIDENCE_URLS:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} At most {str(MAX_EVIDENCE_URLS)} evidence URLs are allowed")
		if c.deadline != "" and u256(int(time.time())) > u256(int(c.deadline)):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} The deadline has passed; work can no longer be submitted")
		for i in range(len(evidence_urls)):
			c.evidence_urls.append(str(evidence_urls[i]))
		c.explanation = str(explanation)
		c.status = STATUS_SUBMITTED

	def _settle_to_worker(self, c: Contract) -> None:
		budget = c.budget_atto
		fee = budget * self.fee_bps // u256(10000)
		if fee > u256(0) and not (self.treasury == Address(c.freelancer)):
			self.credits[self.treasury] = self.credits.get(self.treasury, u256(0)) + fee
		self.credits[Address(c.freelancer)] = (
			self.credits.get(Address(c.freelancer), u256(0)) + budget - fee
		)

	@gl.public.view
	def get_fee_config(self) -> dict:
		return {"fee_bps": self.fee_bps, "treasury": str(self.treasury)}

	@gl.public.write
	def set_fee_config(self, fee_bps: u256, treasury: Address) -> None:
		if gl.message.sender_address != self.owner_addr:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only owner may set the fee configuration")
		if fee_bps > u256(PROTOCOL_FEE_BPS_CAP):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Fee exceeds the protocol cap of {str(PROTOCOL_FEE_BPS_CAP)} bps")
		self.fee_bps = fee_bps
		self.treasury = Address(treasury)

	@gl.public.write
	def propose_amendment(self, contract_id: str, criteria: DynArray[str]) -> None:
		c = self._get(contract_id)
		self._require_client(c)
		if c.status != STATUS_ACCEPTED:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Amendments are only possible after acceptance and before submission")
		if len(criteria) < 1:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} At least one acceptance criterion is required")
		clean = []
		for i in range(len(criteria)):
			clean.append(str(criteria[i]))
		c.amendment_pending = json.dumps(clean)

	@gl.public.write
	def approve_amendment(self, contract_id: str) -> None:
		c = self._get(contract_id)
		if str(gl.message.sender_address) != c.freelancer:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the freelancer may approve an amendment")
		if c.status != STATUS_ACCEPTED:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Amendments are only possible before submission")
		if c.amendment_pending == "":
			raise gl.vm.UserError(f"{ERROR_EXPECTED} No amendment has been proposed")
		new_criteria = json.loads(c.amendment_pending)
		while len(c.criteria) > 0:
			c.criteria.pop()
		for i in range(len(new_criteria)):
			c.criteria.append(str(new_criteria[i]))
		c.amendment_pending = ""

	@gl.public.write
	def cancel_amendment(self, contract_id: str) -> None:
		c = self._get(contract_id)
		self._require_client(c)
		if c.amendment_pending == "":
			raise gl.vm.UserError(f"{ERROR_EXPECTED} No amendment has been proposed")
		c.amendment_pending = ""

	@gl.public.write
	def refund_expired(self, contract_id: str) -> None:
		c = self._get(contract_id)
		if c.deadline == "":
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract has no deadline")
		if u256(int(time.time())) <= u256(int(c.deadline)):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} The deadline has not passed yet")
		if c.status not in (STATUS_OPEN, STATUS_ACCEPTED):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only unfunded-work contracts can expire")
		self.credits[c.client] = self.credits.get(c.client, u256(0)) + c.budget_atto
		c.status = STATUS_EXPIRED

	@gl.public.write
	def rate_contract(self, contract_id: str, rating: u256) -> None:
		c = self._get(contract_id)
		self._require_client(c)
		if c.status != STATUS_PAID:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only settled contracts can be rated")
		if c.rated:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract already rated")
		if rating < u256(1) or rating > u256(5):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Rating must be between 1 and 5")
		c.rating = rating
		c.rated = True

	@gl.public.view
	def reputation_of(self, who: Address) -> dict:
		target = str(Address(who))
		total = 0
		count = 0
		for i in range(len(self.contract_ids)):
			c = self.contracts.get(str(self.contract_ids[i]))
			if c is None or c.status != STATUS_PAID or not c.rated:
				continue
			if str(c.freelancer) == target:
				total = total + int(c.rating)
				count = count + 1
		if count == 0:
			return {"avg_rating_x10": u256(0), "count": u256(0)}
		return {"avg_rating_x10": u256(total * 10 // count), "count": u256(count)}

	@gl.public.write
	def verify_work(self, contract_id: str) -> None:
		c = self._get(contract_id)
		if c.status != STATUS_SUBMITTED:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Verification requires a submitted contract")

		description_text = str(c.description)
		criteria_text = ""
		for i in range(len(c.criteria)):
			criteria_text = criteria_text + str(i + 1) + ". " + str(c.criteria[i]) + "\n"
		explanation_text = str(c.explanation)
		evidence_text = ""
		evidence_url_list = []
		for i in range(len(c.evidence_urls)):
			evidence_url_list.append(str(c.evidence_urls[i]))
			evidence_text = evidence_text + "[EVIDENCE " + str(i + 1) + ": " + str(c.evidence_urls[i]) + "]\n"

		def leader_fn() -> dict:
			evidence_blocks = ""
			fetch_failures = 0
			for i in range(len(evidence_url_list)):
				url = evidence_url_list[i]
				try:
					res = gl.nondet.web.get(url)
					http_status = int(res.status)
					if http_status >= 500:
						evidence_blocks = evidence_blocks + "[EVIDENCE " + str(i + 1) + " " + url + " temporarily unavailable]\n"
						fetch_failures = fetch_failures + 1
						continue
					if http_status >= 400:
						evidence_blocks = evidence_blocks + "[EVIDENCE " + str(i + 1) + " " + url + " could not be retrieved: HTTP " + str(http_status) + "]\n"
						fetch_failures = fetch_failures + 1
						continue
					body = res.body.decode("utf-8", "ignore")[:EVIDENCE_CHARS]
					evidence_blocks = evidence_blocks + "[EVIDENCE " + str(i + 1) + " " + url + "]\n" + body + "\n"
				except Exception:
					evidence_blocks = evidence_blocks + "[EVIDENCE " + str(i + 1) + " " + url + " could not be retrieved]\n"
					fetch_failures = fetch_failures + 1
			if fetch_failures == len(c.evidence_urls):
				raise gl.vm.UserError(f"{ERROR_TRANSIENT} No evidence could be retrieved; try again later")

			prompt = (
				"You are verifying completed freelance work against pre-agreed acceptance criteria.\n"
				"Judge ONLY the criteria below. Do not invent requirements.\n"
				"If a criterion cannot be checked with the given evidence, mark it UNVERIFIABLE.\n\n"
				"WORK AGREEMENT:\n<agreement>" + description_text + "</agreement>\n\n"
				"ACCEPTANCE CRITERIA:\n<criteria>" + criteria_text + "</criteria>\n\n"
				"FREELANCER EXPLANATION:\n<explanation>" + explanation_text + "</explanation>\n\n"
				"RETRIEVED EVIDENCE:\n<evidence>" + evidence_blocks + "</evidence>\n\n"
				'Reply with JSON exactly like: {"overall": "PASSED" or "FAILED", '
				'"criteria": [{"index": 1, "result": "PASS" or "FAIL" or "UNVERIFIABLE", "reason": "short evidence-based reason"}], '
				'"reasoning": "one short paragraph"} '
				"where overall is PASSED only if no criterion is FAIL and at most one is UNVERIFIABLE."
			)
			analysis = gl.nondet.exec_prompt(prompt, response_format="json")
			parsed = _parse_llm_json(analysis)
			overall = str(parsed.get("overall", "")).strip().upper()
			if overall not in ("PASSED", "FAILED"):
				raise gl.vm.UserError(f"{ERROR_LLM} invalid overall verdict: {str(parsed.get('overall'))}")
			raw_criteria = parsed.get("criteria")
			if not isinstance(raw_criteria, list) or len(raw_criteria) == 0:
				raise gl.vm.UserError(f"{ERROR_LLM} missing per-criterion results")
			clean = []
			for item in raw_criteria:
				if not isinstance(item, dict):
					continue
				res = str(item.get("result", "")).strip().upper()
				if res not in ("PASS", "FAIL", "UNVERIFIABLE"):
					res = "UNVERIFIABLE"
				clean.append({"index": item.get("index", 0), "result": res, "reason": str(item.get("reason", ""))[:300]})
			if len(clean) == 0:
				raise gl.vm.UserError(f"{ERROR_LLM} no valid criterion results")
			return {"overall": overall, "criteria": clean, "reasoning": str(parsed.get("reasoning", ""))[:600]}

		def validator_fn(leaders_res: gl.vm.Result) -> bool:
			if not isinstance(leaders_res, gl.vm.Return):
				return _handle_leader_error(leaders_res, leader_fn)
			try:
				leader_overall = str(leaders_res.calldata.get("overall", ""))
				leader_crit = leaders_res.calldata.get("criteria", [])
				fresh = leader_fn()
			except Exception:
				return False
			if str(fresh.get("overall", "")) != leader_overall:
				return False
			leader_map = {}
			for item in leader_crit:
				if isinstance(item, dict):
					leader_map[int(item.get("index", 0))] = str(item.get("result", ""))
			mismatches = 0
			for item in fresh.get("criteria", []):
				idx = int(item.get("index", 0))
				if idx in leader_map and leader_map[idx] != str(item.get("result", "")):
					mismatches = mismatches + 1
			return mismatches <= 1

		c.status = STATUS_VERIFYING
		result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

		c.verdict_overall = str(result["overall"])
		try:
			c.verdict_criteria = json.dumps(result["criteria"])
		except Exception:
			c.verdict_criteria = "[]"
		c.verdict_reasoning = str(result["reasoning"])

		now_ts = u256(int(time.time()))
		if result["overall"] == "PASSED":
			c.verified_ts = now_ts
			c.dispute_window_end = now_ts + u256(CLIENT_REVIEW_SECONDS)
			c.status = STATUS_VERIFIED
		else:
			c.failed_ts = now_ts
			c.dispute_window_end = now_ts + u256(DISPUTE_WINDOW_SECONDS)
			c.status = STATUS_FAILED

	@gl.public.write
	def approve_release(self, contract_id: str) -> None:
		c = self._get(contract_id)
		self._require_client(c)
		if c.status != STATUS_VERIFIED:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Release requires a verified contract")
		self._settle_to_worker(c)
		c.status = STATUS_PAID

	@gl.public.write
	def force_release(self, contract_id: str) -> None:
		c = self._get(contract_id)
		if str(gl.message.sender_address) != c.freelancer:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the freelancer may force release")
		if c.status != STATUS_VERIFIED:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Release requires a verified contract")
		if u256(int(time.time())) < max(c.dispute_window_end, c.verified_ts + u256(FORCE_RELEASE_DELAY_SECONDS)):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} The client review window is still open")
		self._settle_to_worker(c)
		c.status = STATUS_PAID

	@gl.public.write
	def open_dispute(self, contract_id: str, reason: str) -> None:
		c = self._get(contract_id)
		sender = str(gl.message.sender_address)
		if sender != str(c.client) and sender != c.freelancer:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only contract parties may open a dispute")
		if c.status not in (STATUS_FAILED, STATUS_VERIFIED):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Disputes are opened after verification")
		if c.dispute_window_end != u256(0) and u256(int(time.time())) >= c.dispute_window_end:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} The dispute window has closed")
		if not reason.strip():
			raise gl.vm.UserError(f"{ERROR_EXPECTED} A dispute reason is required")
		c.dispute_reason = str(reason)
		c.status = STATUS_DISPUTED

	@gl.public.write
	def refund_client(self, contract_id: str) -> None:
		c = self._get(contract_id)
		self._require_client(c)
		if c.status != STATUS_FAILED:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Refund is only available after a failed verification")
		if c.dispute_window_end != u256(0) and u256(int(time.time())) < c.dispute_window_end:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} The freelancer dispute window is still open")
		self.credits[c.client] = self.credits.get(c.client, u256(0)) + c.budget_atto
		c.status = STATUS_REFUNDED

	@gl.public.write
	def resolve_dispute(self, contract_id: str) -> None:
		c = self._get(contract_id)
		if c.status != STATUS_DISPUTED:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Contract is not disputed")

		description_text = str(c.description)
		criteria_text = ""
		n_criteria = len(c.criteria)
		for i in range(n_criteria):
			criteria_text = criteria_text + str(i + 1) + ". " + str(c.criteria[i]) + "\n"
		explanation_text = str(c.explanation)
		evidence_url_list = []
		for i in range(len(c.evidence_urls)):
			evidence_url_list.append(str(c.evidence_urls[i]))
		dispute_reason = str(c.dispute_reason)
		original_verdict = str(c.verdict_overall) + " — " + str(c.verdict_reasoning)

		def leader_fn() -> dict:
			# Re-retrieve the submitted evidence exactly as verify_work does,
			# so the arbitration rests on fresh evidence, not the leader's claim.
			evidence_blocks = ""
			fetch_failures = 0
			for i in range(len(evidence_url_list)):
				url = evidence_url_list[i]
				try:
					res = gl.nondet.web.get(url)
					http_status = int(res.status)
					if http_status >= 500:
						raise gl.vm.UserError(f"{ERROR_TRANSIENT} evidence temporarily unavailable")
					if http_status >= 400:
						evidence_blocks = evidence_blocks + "[EVIDENCE " + str(i + 1) + " " + url + " could not be retrieved: HTTP " + str(http_status) + "]\n"
						continue
					body = res.body.decode("utf-8", "ignore")[:EVIDENCE_CHARS]
					evidence_blocks = evidence_blocks + "[EVIDENCE " + str(i + 1) + " " + url + "]\n" + body + "\n"
				except gl.vm.UserError:
					raise
				except Exception:
					evidence_blocks = evidence_blocks + "[EVIDENCE " + str(i + 1) + " " + url + " could not be retrieved]\n"
			if fetch_failures == len(evidence_url_list):
				raise gl.vm.UserError(f"{ERROR_TRANSIENT} No evidence could be retrieved; try again later")

			prompt = (
				"You are re-arbitrating a disputed freelance contract. The acceptance criteria were "
				"fixed when the contract was created and MUST NOT be rewritten or reinterpreted loosely.\n"
				"Decide ONLY whether the retrieved evidence satisfies the ORIGINAL criteria, "
				"scoring every single criterion. Do not invent requirements or evidence.\n\n"
				"ORIGINAL WORK AGREEMENT:\n<agreement>" + description_text + "</agreement>\n\n"
				"ORIGINAL ACCEPTANCE CRITERIA:\n<criteria>" + criteria_text + "</criteria>\n\n"
				"FREELANCER EXPLANATION:\n<explanation>" + explanation_text + "</explanation>\n\n"
				"RETRIEVED EVIDENCE:\n<evidence>" + evidence_blocks + "</evidence>\n\n"
				"DISPUTE REASON:\n<reason>" + dispute_reason + "</reason>\n\n"
				"ORIGINAL AUTOMATED VERDICT (context only — you may overturn it if the evidence warrants):\n"
				"<verdict>" + original_verdict + "</verdict>\n\n"
				'Reply with JSON exactly like: {"for_worker": true or false, '
				'"criteria": [{"index": 1, "result": "PASS" or "FAIL" or "UNVERIFIABLE", "reason": "short evidence-based reason"}], '
				'"reasoning": "one short paragraph"} '
				"where for_worker is true only if no criterion fails and at most one is UNVERIFIABLE. "
				"You MUST include every criterion index."
			)
			analysis = gl.nondet.exec_prompt(prompt, response_format="json")
			parsed = _parse_llm_json(analysis)
			raw = parsed.get("for_worker")
			if raw is None:
				for alt in ("worker_wins", "approved"):
					if alt in parsed:
						raw = parsed[alt]
						break
			if raw is None:
				raise gl.vm.UserError(f"{ERROR_LLM} missing for_worker in LLM output")
			if isinstance(raw, bool):
				verdict = raw
			else:
				verdict = str(raw).strip().lower() in ("true", "yes", "1")
			crit_out = []
			for item in parsed.get("criteria", []) if isinstance(parsed.get("criteria"), list) else []:
				if isinstance(item, dict):
					res = str(item.get("result", "")).strip().upper()
					if res in ("PASS", "FAIL", "UNVERIFIABLE"):
						crit_out.append({"index": int(item.get("index", 0)), "result": res, "reason": str(item.get("reason", ""))[:300]})
			return {
				"for_worker": verdict,
				"criteria": crit_out,
				"reasoning": str(parsed.get("reasoning", ""))[:600],
			}

		def validator_fn(leaders_res: gl.vm.Result) -> bool:
			if not isinstance(leaders_res, gl.vm.Return):
				return _handle_leader_error(leaders_res, leader_fn)
			try:
				leader_verdict = bool(leaders_res.calldata.get("for_worker"))
				leader_crit = leaders_res.calldata.get("criteria", [])
				fresh = leader_fn()
			except Exception:
				return False
			if leader_verdict != bool(fresh.get("for_worker")):
				return False
			leader_map = {}
			for item in leader_crit:
				if isinstance(item, dict):
					leader_map[int(item.get("index", 0))] = str(item.get("result", ""))
			mismatches = 0
			for item in fresh.get("criteria", []):
				idx = int(item.get("index", 0))
				if idx in leader_map and leader_map[idx] != str(item.get("result", "")):
					mismatches += 1
			return mismatches <= 1

		result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

		if result["for_worker"]:
			self._settle_to_worker(c)
			c.status = STATUS_PAID
		else:
			self.credits[c.client] = self.credits.get(c.client, u256(0)) + c.budget_atto
			c.status = STATUS_REFUNDED
		c.verdict_reasoning = str(result["reasoning"])

	@gl.public.write
	def cancel_open(self, contract_id: str) -> None:
		c = self._get(contract_id)
		self._require_client(c)
		if c.status != STATUS_OPEN:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only open contracts can be cancelled")
		self.credits[c.client] = self.credits.get(c.client, u256(0)) + c.budget_atto
		c.status = STATUS_CANCELLED

	@gl.public.write
	def withdraw(self) -> None:
		who = gl.message.sender_address
		amount = self.credits.get(who, u256(0))
		if amount == u256(0):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Nothing to withdraw")
		self.credits[who] = u256(0)
		_Recipient(who).emit_transfer(value=u256(amount))

	@gl.public.view
	def get_contract(self, contract_id: str) -> dict:
		c = self._get(contract_id)
		criteria_list = []
		for i in range(len(c.criteria)):
			criteria_list.append(str(c.criteria[i]))
		evidence_list = []
		for i in range(len(c.evidence_urls)):
			evidence_list.append(str(c.evidence_urls[i]))
		return {
			"client": str(c.client),
			"freelancer": c.freelancer,
			"title": c.title,
			"description": c.description,
			"criteria": criteria_list,
			"deadline": c.deadline,
			"budget_atto": c.budget_atto,
			"status": c.status,
			"evidence_urls": evidence_list,
			"explanation": c.explanation,
			"dispute_reason": c.dispute_reason,
			"verdict_overall": c.verdict_overall,
			"verdict_criteria": c.verdict_criteria,
			"verdict_reasoning": c.verdict_reasoning,
			"verified_ts": c.verified_ts,
			"amendment_pending": c.amendment_pending,
			"rating": c.rating,
			"rated": c.rated,
		}

	@gl.public.view
	def credit_of(self, who: Address) -> u256:
		return self.credits.get(Address(who), u256(0))


@gl.evm.contract_interface
class _Recipient:
	class View:
		pass

	class Write:
		pass
