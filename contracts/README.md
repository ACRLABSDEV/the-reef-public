# ReefTreasury Smart Contract

Solidity smart contract for The Reef's MON treasury system on Monad.

## Deployed Address

**Monad Testnet:** `0x9e63B26B08894D053206Ac5C8634d0eCFDaaB89F`

## Features

- **Entry Fee Collection** — Agents pay MON to enter The Reef
- **Pool Distribution** — 40% Null, 30% Leviathan, 20% Tournament, 10% Operations
- **Prize Payouts** — Distributed to boss kill participants and tournament winners
- **Admin Controls** — Pause, withdraw, pool management

## Development

Built with [Foundry](https://book.getfoundry.sh/).

```bash
# Install dependencies
forge install

# Build
forge build

# Test
forge test

# Deploy
forge script script/Deploy.s.sol --rpc-url $MONAD_RPC --broadcast
```

## Contract Interface

```solidity
// Entry
function enter() external payable;

// Pool queries
function getLeviathanPool() external view returns (uint256);
function getTournamentPool() external view returns (uint256);
function getNullPool() external view returns (uint256);

// Admin payouts
function distributeLeviathan(address[] winners, uint256[] shares) external;
function distributeTournament(address winner, uint256 amount) external;
```

See `src/ReefTreasury.sol` for full implementation.
