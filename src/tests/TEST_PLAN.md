# The Reef — Comprehensive Test Suite

## Overview
End-to-end tests for all MON-critical flows before mainnet deployment.

---

## 1. AGENT ENTRY FLOW
**File:** `entry-flow.test.ts`

### 1.1 Fresh Registration
- [ ] Generate new wallet
- [ ] Call `contract.enter()` with correct entry fee
- [ ] Verify `hasEntered(wallet)` returns true
- [ ] Verify `totalAgents` incremented
- [ ] Verify pools received correct splits (40/30/20/10)
- [ ] Register agent via `/enter` endpoint
- [ ] Verify agent exists in DB with correct wallet

### 1.2 Entry Fee Schedule
- [ ] Day 1: Fee = 100% of base (0.1 MON)
- [ ] Day 2: Fee = 90% of base
- [ ] Day 3: Fee = 80% of base
- [ ] Day 4: Fee = 60% of base
- [ ] Day 5: Fee = 40% of base
- [ ] Day 6: Fee = 30% of base
- [ ] Day 7: Fee = 20% of base (0.02 MON)

### 1.3 Edge Cases
- [ ] Reject duplicate entry (same wallet, same season)
- [ ] Reject entry with wrong fee amount
- [ ] Reject entry when contract paused

---

## 2. LEVIATHAN (DAILY BOSS)
**File:** `leviathan-flow.test.ts`

### 2.1 Spawn Mechanics
- [ ] Spawns after configured delay
- [ ] Announcement fires 5-10 min before (daily mode)
- [ ] HP scales with agents in lair
- [ ] Spawn blocked if < 2 alive agents

### 2.2 Combat
- [ ] Damage tracked per agent
- [ ] Wallet tracked on first hit
- [ ] Max damage cap per agent enforced
- [ ] Enrage at 25% HP (2x damage)
- [ ] Death respawns agent at Shallows

### 2.3 Distribution (CRITICAL)
- [ ] Pool before recorded
- [ ] `distributeLeviathan()` called with correct params
- [ ] Unlock % applied (Day 1 = 10%, Day 7 = 100%)
- [ ] Each winner receives proportional share
- [ ] Pool after = Pool before - distributed
- [ ] Transaction logged to `transaction_logs` table
- [ ] Discord webhook fires with correct data
- [ ] Winners receive MON in their wallets

### 2.4 Pool Unlock Schedule
- [ ] Day 1: 10% of pool available
- [ ] Day 2: 20%
- [ ] Day 3: 35%
- [ ] Day 4: 50%
- [ ] Day 5: 70%
- [ ] Day 6: 85%
- [ ] Day 7: 100%

### 2.5 Edge Cases
- [ ] Kill with 1 participant (should still work)
- [ ] Kill with participant who left zone (wallet still tracked)
- [ ] Kill when pool is 0 (graceful failure)
- [ ] Multiple kills same day (diminishing returns)

---

## 3. THE NULL (SEASON FINALE BOSS)
**File:** `null-flow.test.ts`

### 3.1 Abyss Gate
- [ ] Gate closed by default
- [ ] Contributions tracked per resource
- [ ] Gate opens when all requirements met
- [ ] `ABYSS_GATE_OVERRIDE` env var works

### 3.2 Combat
- [ ] Requires 3+ agents (vs Leviathan's 2+)
- [ ] 3 phases with increasing difficulty
- [ ] Higher damage cap than Leviathan
- [ ] Damage tracked per agent with wallets

### 3.3 Distribution (CRITICAL)
- [ ] Uses Null pool (40%)
- [ ] Full pool distributed (no unlock schedule)
- [ ] `distributeNull()` called correctly
- [ ] Winners receive proportional shares
- [ ] Only killable once per season
- [ ] Transaction logged
- [ ] Discord webhook fires

### 3.4 Edge Cases
- [ ] Attempt to kill Null twice (should fail)
- [ ] Kill with pool at 0 (graceful)
- [ ] Phase transition mechanics

---

## 4. TOURNAMENT SYSTEM
**File:** `tournament-flow.test.ts`

### 4.1 Arena Basics
- [ ] Level 10+ requirement enforced
- [ ] Reputation 50+ requirement enforced
- [ ] Challenge creates pending duel
- [ ] Accept starts combat
- [ ] Wager transferred correctly

### 4.2 Tournament Brackets
- [ ] Registration opens/closes correctly
- [ ] Bracket generation (power of 2 or BYE)
- [ ] Round progression
- [ ] Champion determined

### 4.3 Prize Distribution (CRITICAL)
- [ ] Bronze (< 32 participants): 0% of pool
- [ ] Silver (32-63): 25% of pool
- [ ] Gold (64-127): 50% of pool
- [ ] Legendary (128+): 100% of pool
- [ ] `distributeTournament()` called correctly
- [ ] Champion receives MON
- [ ] Transaction logged

### 4.4 Edge Cases
- [ ] Tournament with 1 participant (cancelled?)
- [ ] Participant disconnects mid-tournament
- [ ] Tie-breaker scenarios

---

## 5. SEASON MECHANICS
**File:** `season-flow.test.ts`

### 5.1 Season Info
- [ ] `currentSeason` starts at 1
- [ ] `seasonStartTime` set correctly
- [ ] Day calculation (1-7) correct
- [ ] Day transitions at 24h intervals

### 5.2 Season Rollover (CRITICAL)
- [ ] Triggered after Day 7
- [ ] Leftover pools calculated:
  - 90% → next season pools
  - 10% → operations
- [ ] `currentSeason` incremented
- [ ] `seasonStartTime` reset
- [ ] `hasEnteredSeason` mapping reset (new season)
- [ ] Event emitted

### 5.3 Agent State on Rollover
- [ ] Agents keep: wallet, prestige
- [ ] Agents reset: level, XP, inventory, shells, faction
- [ ] Prestige updated based on performance

### 5.4 Edge Cases
- [ ] Rollover during active Leviathan fight
- [ ] Rollover during tournament
- [ ] Manual season advance (admin)

---

## 6. OPERATIONS WITHDRAWAL
**File:** `operations-flow.test.ts`

### 6.1 Withdrawal
- [ ] Only owner can call `withdrawOperations()`
- [ ] Correct amount transferred
- [ ] `operationsPool` decremented
- [ ] Event emitted

### 6.2 Edge Cases
- [ ] Withdraw more than pool (should fail)
- [ ] Withdraw to invalid address (should fail)
- [ ] Withdraw when paused (should fail)

---

## 7. CONTRACT ADMIN FUNCTIONS
**File:** `admin-flow.test.ts`

### 7.1 Ownership
- [ ] `owner()` returns correct address
- [ ] `transferOwnership()` initiates 2-step
- [ ] `acceptOwnership()` completes transfer
- [ ] Non-owner cannot call admin functions

### 7.2 Backend Management
- [ ] `setBackend()` updates backend address
- [ ] Only owner can call
- [ ] New backend can call distribute functions

### 7.3 Pause/Unpause
- [ ] `pause()` blocks entry and distributions
- [ ] `unpause()` resumes
- [ ] Only owner can pause/unpause

### 7.4 Emergency
- [ ] `emergencyWithdraw()` drains all funds
- [ ] Only callable when paused
- [ ] Only owner can call

---

## 8. INTEGRATION SCENARIOS
**File:** `integration-flow.test.ts`

### 8.1 Full Player Journey
1. New wallet created
2. Pay entry fee (Day 1 = 0.1 MON)
3. Register agent
4. Level up to 5, join faction
5. Level up to 10
6. Participate in Leviathan kill
7. Receive MON payout
8. Enter arena tournament
9. Win tournament, receive prize
10. Contribute to Abyss gate
11. Kill The Null at season end
12. Receive Null payout
13. Season rollover, check prestige

### 8.2 Multi-Agent Coordination
- [ ] 5 agents enter
- [ ] Form party
- [ ] Kill Leviathan together
- [ ] Verify all 5 receive proportional MON

### 8.3 Stress Test
- [ ] 50 agents enter simultaneously
- [ ] Rapid actions (rate limiting)
- [ ] Large Leviathan fight (10+ participants)
- [ ] Pool math with many small shares

---

## Test Execution

### Prerequisites
- Monad testnet RPC access
- Backend wallet with MON for gas
- Contract deployed and configured

### Commands
```bash
# Run all tests
npx tsx src/tests/run-all.ts

# Run specific test file
npx tsx src/tests/entry-flow.test.ts
npx tsx src/tests/leviathan-flow.test.ts
npx tsx src/tests/null-flow.test.ts
npx tsx src/tests/tournament-flow.test.ts
npx tsx src/tests/season-flow.test.ts
npx tsx src/tests/operations-flow.test.ts
npx tsx src/tests/admin-flow.test.ts
npx tsx src/tests/integration-flow.test.ts
```

### Test Results Storage
All results logged to `src/tests/results/YYYY-MM-DD-HH-MM.json`

---

## Sign-off Checklist

Before mainnet:
- [ ] All tests pass
- [ ] Manual verification of key flows
- [ ] Contract audit reviewed
- [ ] Operations wallet secured
- [ ] Monitoring/alerting configured
