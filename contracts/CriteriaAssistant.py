# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
import json


ERROR_LLM = "[LLM_ERROR]"
ERROR_TRANSIENT = "[TRANSIENT]"


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
		if validator_msg.startswith(ERROR_LLM):
			return validator_msg == leader_msg
		if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
			return True
		return False
	except Exception:
		return False


@allow_storage
@dataclass
class Draft:
	brief: str
	title: str
	description: str
	criteria: str
	deadline_hint: str


class CriteriaAssistant(gl.Contract):
	drafts: TreeMap[str, Draft]

	def __init__(self) -> None:
		pass

	@gl.public.view
	def get_draft(self, request_id: str) -> dict:
		d = self.drafts.get(request_id)
		if d is None:
			raise gl.vm.UserError(f"{ERROR_LLM} Unknown request id")
		return {
			"brief": d.brief,
			"title": d.title,
			"description": d.description,
			"criteria": d.criteria,
			"deadline_hint": d.deadline_hint,
		}

	@gl.public.write
	def draft_criteria(self, request_id: str, brief: str) -> None:
		if self.drafts.get(request_id) is not None:
			raise gl.vm.UserError(f"{ERROR_LLM} Request id already used")
		brief_text = str(brief)

		def leader_fn() -> dict:
			prompt = (
				"Convert this freelance work request into a structured work contract draft.\n"
				"Write 3-6 OBJECTIVE acceptance criteria that can be verified from evidence "
				"a freelancer would submit (deployed URLs, repositories, documents). "
				"Criteria must be checkable, not subjective. Do not invent requirements "
				"that are not implied by the request.\n\n"
				"REQUEST:\n<brief>" + brief_text + "</brief>\n\n"
				'Reply with JSON exactly like: {"title": "...", "description": "...", '
				'"criteria": ["...", "..."], "deadline_hint": "e.g. 7 days or empty"}'
			)
			analysis = gl.nondet.exec_prompt(prompt, response_format="json")
			parsed = _parse_llm_json(analysis)
			title = str(parsed.get("title", "")).strip()
			description = str(parsed.get("description", "")).strip()
			raw_criteria = parsed.get("criteria")
			if not title or not description:
				raise gl.vm.UserError(f"{ERROR_LLM} draft missing title or description")
			if not isinstance(raw_criteria, list) or len(raw_criteria) == 0:
				raise gl.vm.UserError(f"{ERROR_LLM} draft has no criteria")
			clean = []
			for item in raw_criteria[:8]:
				text = str(item).strip()
				if text:
					clean.append(text[:300])
			if len(clean) == 0:
				raise gl.vm.UserError(f"{ERROR_LLM} draft has no usable criteria")
			return {
				"title": title[:200],
				"description": description[:800],
				"criteria": clean,
				"deadline_hint": str(parsed.get("deadline_hint", ""))[:40],
			}

		def validator_fn(leaders_res: gl.vm.Result) -> bool:
			if not isinstance(leaders_res, gl.vm.Return):
				return _handle_leader_error(leaders_res, leader_fn)
			try:
				leader_title = str(leaders_res.calldata.get("title", ""))
				leader_n = len(leaders_res.calldata.get("criteria", []))
				fresh = leader_fn()
			except Exception:
				return False
			if not leader_title or not str(fresh.get("title", "")):
				return False
			fresh_n = len(fresh.get("criteria", []))
			return abs(leader_n - fresh_n) <= 2

		result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

		self.drafts[request_id] = Draft(
			brief=brief_text[:1000],
			title=result["title"],
			description=result["description"],
			criteria=json.dumps(result["criteria"]),
			deadline_hint=result["deadline_hint"],
		)
