# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
import time


ERROR_EXPECTED = "[EXPECTED]"

DEFAULT_CLAIM_ATTO = u256(6 * 10 ** 17)          # 0.6 GEN
DEFAULT_COOLDOWN_SECONDS = u256(7 * 24 * 3600)   # 7 days


@allow_storage
@dataclass
class FaucetConfig:
	claim_atto: u256
	cooldown_seconds: u256


class WorkFaucet(gl.Contract):
	owner_addr: Address
	config: FaucetConfig
	last_claim: TreeMap[Address, u256]
	claim_count: u256
	total_dropped: u256
	book: u256

	def __init__(self) -> None:
		self.owner_addr = gl.message.sender_address
		self.config = FaucetConfig(
			claim_atto=DEFAULT_CLAIM_ATTO,
			cooldown_seconds=DEFAULT_COOLDOWN_SECONDS,
		)
		self.claim_count = u256(0)
		self.total_dropped = u256(0)
		self.book = u256(0)

	def _require_owner(self) -> None:
		if gl.message.sender_address != self.owner_addr:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the faucet owner may call this")

	@gl.public.write.payable
	def deposit(self) -> None:
		if gl.message.value == u256(0):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Send GEN with the deposit")
		self.book = self.book + gl.message.value

	@gl.public.write
	def claim(self) -> None:
		who = gl.message.sender_address
		now = u256(int(time.time()))
		last = self.last_claim.get(who, u256(0))
		if last != u256(0) and now < last + self.config.cooldown_seconds:
			wait = (last + self.config.cooldown_seconds) - now
			hours = int(wait) // 3600 + 1
			raise gl.vm.UserError(
				f"{ERROR_EXPECTED} You already claimed this week; try again in about {str(hours)} hour(s)"
			)
		if self.book < self.config.claim_atto:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} The faucet is empty — please try again later")
		self.book = self.book - self.config.claim_atto
		self.last_claim[who] = now
		self.claim_count = self.claim_count + u256(1)
		self.total_dropped = self.total_dropped + self.config.claim_atto
		_Recipient(who).emit_transfer(value=self.config.claim_atto)

	@gl.public.view
	def faucet_info(self) -> dict:
		return {
			"claim_atto": self.config.claim_atto,
			"cooldown_seconds": self.config.cooldown_seconds,
			"balance": self.book,
			"claim_count": self.claim_count,
			"total_dropped": self.total_dropped,
		}

	@gl.public.view
	def next_claim_at(self, who: Address) -> u256:
		last = self.last_claim.get(Address(who), u256(0))
		if last == u256(0):
			return u256(0)
		return last + self.config.cooldown_seconds

	@gl.public.write
	def set_config(self, claim_atto: u256, cooldown_seconds: u256) -> None:
		self._require_owner()
		if claim_atto == u256(0) or cooldown_seconds == u256(0):
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Amount and cooldown must be greater than zero")
		self.config = FaucetConfig(claim_atto=claim_atto, cooldown_seconds=cooldown_seconds)

	@gl.public.write
	def withdraw_owner(self, amount: u256) -> None:
		self._require_owner()
		if amount == u256(0) or amount > self.book:
			raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid withdrawal amount")
		self.book = self.book - amount
		_Recipient(self.owner_addr).emit_transfer(value=u256(amount))


@gl.evm.contract_interface
class _Recipient:
	class View:
		pass

	class Write:
		pass
