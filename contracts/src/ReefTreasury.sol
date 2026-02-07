// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ReefTreasury
 * @notice Treasury contract for The Reef — persistent virtual world for AI agents
 * @dev Handles entry fees, pool management, and reward distribution
 * 
 * Pool Split (Weekly Seasons):
 *   - 40% Null Pool (season finale boss - biggest payout)
 *   - 30% Leviathan Pool (daily boss - consistent income)
 *   - 20% Tournament Pool (arena champions)
 *   - 10% Operations Pool (team/maintenance)
 * 
 * Season Economy:
 *   - Entry fees scale down through the week (50 MON → 10 MON)
 *   - Pool unlock scales up (10% → 100% available for distribution)
 *   - Leftover MON rolls to next season (90%) with ops cut (10%)
 */
contract ReefTreasury is Ownable, Pausable, ReentrancyGuard {
    
    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════
    
    // Entry
    event AgentEntered(
        address indexed agent,
        uint256 amount,
        uint256 seasonDay,
        uint256 timestamp
    );
    
    // Leviathan (Daily Boss)
    event LeviathanSpawned(uint256 indexed spawnId, uint256 timestamp);
    
    event LeviathanKilled(
        uint256 indexed spawnId,
        uint256 participantCount,
        uint256 totalDamage,
        uint256 poolAmount,
        uint256 poolUnlockBps,
        uint256 timestamp
    );
    
    event LeviathanRewardDistributed(
        uint256 indexed spawnId,
        address indexed recipient,
        uint256 amount,
        uint256 damageShare
    );
    
    // The Null (Season Finale Boss)
    event NullSpawned(uint256 indexed seasonId, uint256 timestamp);
    
    event NullKilled(
        uint256 indexed seasonId,
        uint256 participantCount,
        uint256 totalDamage,
        uint256 poolAmount,
        uint256 timestamp
    );
    
    event NullRewardDistributed(
        uint256 indexed seasonId,
        address indexed recipient,
        uint256 amount,
        uint256 damageShare
    );
    
    // Tournament
    event TournamentCreated(
        uint256 indexed tournamentId,
        uint256 participantCount,
        uint8 tier,
        uint256 timestamp
    );
    
    event TournamentCompleted(
        uint256 indexed tournamentId,
        address indexed champion,
        uint256 prizeAmount,
        uint256 timestamp
    );
    
    // Season
    event SeasonStarted(uint256 indexed seasonId, uint256 timestamp);
    event SeasonEnded(uint256 indexed seasonId, uint256 rolloverAmount, uint256 opsAmount, uint256 timestamp);
    
    // Operations
    event OperationsWithdrawn(address indexed recipient, uint256 amount, uint256 timestamp);
    
    // Admin
    event EntryFeeUpdated(uint256 oldFee, uint256 newFee);
    event PoolSplitUpdated(uint256 null_, uint256 leviathan, uint256 tournament, uint256 operations);
    event BackendUpdated(address indexed oldBackend, address indexed newBackend);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    // Base entry fee (day 1 price, scales down through week)
    uint256 public baseEntryFee;
    
    // Pool balances (in wei)
    uint256 public nullPool;
    uint256 public leviathanPool;
    uint256 public tournamentPool;
    uint256 public operationsPool;
    
    // Pool split (basis points, must sum to 10000)
    uint256 public nullSplit = 4000;       // 40% - Season finale
    uint256 public leviathanSplit = 3000;  // 30% - Daily boss
    uint256 public tournamentSplit = 2000; // 20% - Arena
    uint256 public operationsSplit = 1000; // 10% - Team
    
    // Season tracking
    uint256 public currentSeason;
    uint256 public seasonStartTime;
    uint256 public constant SEASON_DURATION = 7 days;
    
    // Entry fee schedule (basis points of base fee per day)
    // Day 1: 100%, Day 2: 90%, ..., Day 7: 20%
    uint256[7] public entryFeeSchedule = [10000, 9000, 8000, 6000, 4000, 3000, 2000];
    
    // Pool unlock schedule (basis points available for distribution per day)
    // Day 1: 10%, Day 2: 20%, ..., Day 7: 100%
    uint256[7] public poolUnlockSchedule = [1000, 2000, 3500, 5000, 7000, 8500, 10000];
    
    // Tracking
    mapping(uint256 => mapping(address => bool)) public hasEnteredSeason; // season => agent => entered
    mapping(address => uint256) public entryTimestamp;
    uint256 public totalAgents;
    uint256 public totalCollected;
    uint256 public totalDistributed;
    
    // Counters
    uint256 public leviathanSpawnCount;
    uint256 public tournamentCount;
    
    // Backend address (can trigger distributions)
    address public backend;
    
    // Tournament tiers: prize multiplier in basis points
    uint256[4] public tournamentMultipliers = [0, 2500, 5000, 10000];
    
    // ═══════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════
    
    modifier onlyBackend() {
        require(msg.sender == backend || msg.sender == owner(), "Not authorized");
        _;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════
    
    constructor(uint256 _baseEntryFee, address _backend) Ownable(msg.sender) {
        baseEntryFee = _baseEntryFee;
        backend = _backend;
        currentSeason = 1;
        seasonStartTime = block.timestamp;
        emit SeasonStarted(1, block.timestamp);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SEASON HELPERS
    // ═══════════════════════════════════════════════════════════════════════
    
    function getSeasonDay() public view returns (uint256) {
        uint256 elapsed = block.timestamp - seasonStartTime;
        uint256 day = elapsed / 1 days;
        return day >= 7 ? 6 : day; // Cap at day 7 (index 6)
    }
    
    function getCurrentEntryFee() public view returns (uint256) {
        uint256 day = getSeasonDay();
        return (baseEntryFee * entryFeeSchedule[day]) / 10000;
    }
    
    function getCurrentPoolUnlock() public view returns (uint256) {
        uint256 day = getSeasonDay();
        return poolUnlockSchedule[day];
    }
    
    function getSeasonInfo() external view returns (
        uint256 season,
        uint256 startTime,
        uint256 day,
        uint256 entryFee,
        uint256 poolUnlockBps
    ) {
        return (
            currentSeason,
            seasonStartTime,
            getSeasonDay() + 1, // 1-indexed for display
            getCurrentEntryFee(),
            getCurrentPoolUnlock()
        );
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // AGENT ENTRY
    // ═══════════════════════════════════════════════════════════════════════
    
    function enter() external payable whenNotPaused nonReentrant {
        require(!hasEnteredSeason[currentSeason][msg.sender], "Already entered this season");
        
        uint256 requiredFee = getCurrentEntryFee();
        require(msg.value == requiredFee, "Incorrect entry fee");
        
        // Mark as entered for this season
        hasEnteredSeason[currentSeason][msg.sender] = true;
        entryTimestamp[msg.sender] = block.timestamp;
        totalAgents++;
        totalCollected += msg.value;
        
        // Split into pools
        uint256 toNull = (msg.value * nullSplit) / 10000;
        uint256 toLevi = (msg.value * leviathanSplit) / 10000;
        uint256 toTournament = (msg.value * tournamentSplit) / 10000;
        uint256 toOps = msg.value - toNull - toLevi - toTournament;
        
        nullPool += toNull;
        leviathanPool += toLevi;
        tournamentPool += toTournament;
        operationsPool += toOps;
        
        emit AgentEntered(msg.sender, msg.value, getSeasonDay() + 1, block.timestamp);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // LEVIATHAN DISTRIBUTION (Daily Boss)
    // ═══════════════════════════════════════════════════════════════════════
    
    function recordLeviathanSpawn() external onlyBackend {
        leviathanSpawnCount++;
        emit LeviathanSpawned(leviathanSpawnCount, block.timestamp);
    }
    
    function distributeLeviathan(
        uint256 spawnId,
        address[] calldata winners,
        uint256[] calldata shares,
        uint256 totalDamage
    ) external onlyBackend nonReentrant {
        require(winners.length == shares.length, "Length mismatch");
        require(winners.length > 0, "No winners");
        require(leviathanPool > 0, "Pool empty");
        
        // Only distribute unlocked portion of pool
        uint256 unlockBps = getCurrentPoolUnlock();
        uint256 availablePool = (leviathanPool * unlockBps) / 10000;
        uint256 distributed = 0;
        
        for (uint256 i = 0; i < winners.length; i++) {
            require(hasEnteredSeason[currentSeason][winners[i]], "Winner not registered");
            
            uint256 reward = (availablePool * shares[i]) / 10000;
            if (reward > 0) {
                distributed += reward;
                (bool success, ) = winners[i].call{value: reward}("");
                require(success, "Transfer failed");
                emit LeviathanRewardDistributed(spawnId, winners[i], reward, shares[i]);
            }
        }
        
        leviathanPool -= distributed;
        totalDistributed += distributed;
        
        emit LeviathanKilled(spawnId, winners.length, totalDamage, distributed, unlockBps, block.timestamp);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // NULL DISTRIBUTION (Season Finale Boss)
    // ═══════════════════════════════════════════════════════════════════════
    
    function recordNullSpawn() external onlyBackend {
        emit NullSpawned(currentSeason, block.timestamp);
    }
    
    function distributeNull(
        address[] calldata winners,
        uint256[] calldata shares,
        uint256 totalDamage
    ) external onlyBackend nonReentrant {
        require(winners.length == shares.length, "Length mismatch");
        require(winners.length > 0, "No winners");
        require(nullPool > 0, "Pool empty");
        
        // Null always distributes 100% of pool (it's the finale)
        uint256 poolAmount = nullPool;
        uint256 distributed = 0;
        
        for (uint256 i = 0; i < winners.length; i++) {
            require(hasEnteredSeason[currentSeason][winners[i]], "Winner not registered");
            
            uint256 reward = (poolAmount * shares[i]) / 10000;
            if (reward > 0) {
                distributed += reward;
                (bool success, ) = winners[i].call{value: reward}("");
                require(success, "Transfer failed");
                emit NullRewardDistributed(currentSeason, winners[i], reward, shares[i]);
            }
        }
        
        nullPool -= distributed;
        totalDistributed += distributed;
        
        emit NullKilled(currentSeason, winners.length, totalDamage, distributed, block.timestamp);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // TOURNAMENT DISTRIBUTION
    // ═══════════════════════════════════════════════════════════════════════
    
    function recordTournamentCreated(uint256 participantCount, uint8 tier) external onlyBackend {
        require(tier < 4, "Invalid tier");
        tournamentCount++;
        emit TournamentCreated(tournamentCount, participantCount, tier, block.timestamp);
    }
    
    function distributeTournament(
        uint256 tournamentId,
        address champion,
        uint8 tier
    ) external onlyBackend nonReentrant {
        require(hasEnteredSeason[currentSeason][champion], "Champion not registered");
        require(tier < 4, "Invalid tier");
        require(tournamentPool > 0 || tier == 0, "Pool empty");
        
        // Apply pool unlock to tournament as well
        uint256 unlockBps = getCurrentPoolUnlock();
        uint256 availablePool = (tournamentPool * unlockBps) / 10000;
        
        uint256 multiplier = tournamentMultipliers[tier];
        uint256 prize = (availablePool * multiplier) / 10000;
        
        if (prize > 0) {
            tournamentPool -= prize;
            totalDistributed += prize;
            (bool success, ) = champion.call{value: prize}("");
            require(success, "Transfer failed");
        }
        
        emit TournamentCompleted(tournamentId, champion, prize, block.timestamp);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SEASON MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * @notice End current season and start new one
     * @dev Rolls over remaining pools (90% to next season, 10% to ops)
     */
    function endSeason() external onlyBackend {
        require(block.timestamp >= seasonStartTime + SEASON_DURATION, "Season not over");
        
        // Calculate rollover
        uint256 remaining = nullPool + leviathanPool + tournamentPool;
        uint256 toOps = (remaining * 1000) / 10000; // 10% to ops
        uint256 rollover = remaining - toOps;
        
        // Reset pools
        operationsPool += toOps;
        nullPool = (rollover * nullSplit) / 10000;
        leviathanPool = (rollover * leviathanSplit) / 10000;
        tournamentPool = rollover - nullPool - leviathanPool;
        
        emit SeasonEnded(currentSeason, rollover, toOps, block.timestamp);
        
        // Start new season
        currentSeason++;
        seasonStartTime = block.timestamp;
        
        emit SeasonStarted(currentSeason, block.timestamp);
    }
    
    /**
     * @notice Force start new season (admin override)
     */
    function forceNewSeason() external onlyOwner {
        uint256 remaining = nullPool + leviathanPool + tournamentPool;
        uint256 toOps = (remaining * 1000) / 10000;
        uint256 rollover = remaining - toOps;
        
        operationsPool += toOps;
        nullPool = (rollover * nullSplit) / 10000;
        leviathanPool = (rollover * leviathanSplit) / 10000;
        tournamentPool = rollover - nullPool - leviathanPool;
        
        emit SeasonEnded(currentSeason, rollover, toOps, block.timestamp);
        
        currentSeason++;
        seasonStartTime = block.timestamp;
        
        emit SeasonStarted(currentSeason, block.timestamp);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function withdrawOperations(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        
        uint256 toWithdraw = amount == 0 ? operationsPool : amount;
        require(toWithdraw <= operationsPool, "Insufficient balance");
        
        operationsPool -= toWithdraw;
        totalDistributed += toWithdraw;
        
        (bool success, ) = recipient.call{value: toWithdraw}("");
        require(success, "Transfer failed");
        
        emit OperationsWithdrawn(recipient, toWithdraw, block.timestamp);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════════════════
    
    function setBaseEntryFee(uint256 _baseEntryFee) external onlyOwner {
        emit EntryFeeUpdated(baseEntryFee, _baseEntryFee);
        baseEntryFee = _baseEntryFee;
    }
    
    function setPoolSplit(
        uint256 _null,
        uint256 _leviathan,
        uint256 _tournament,
        uint256 _operations
    ) external onlyOwner {
        require(_null + _leviathan + _tournament + _operations == 10000, "Must sum to 10000");
        nullSplit = _null;
        leviathanSplit = _leviathan;
        tournamentSplit = _tournament;
        operationsSplit = _operations;
        emit PoolSplitUpdated(_null, _leviathan, _tournament, _operations);
    }
    
    function setEntryFeeSchedule(uint256[7] calldata schedule) external onlyOwner {
        entryFeeSchedule = schedule;
    }
    
    function setPoolUnlockSchedule(uint256[7] calldata schedule) external onlyOwner {
        poolUnlockSchedule = schedule;
    }
    
    function setBackend(address _backend) external onlyOwner {
        emit BackendUpdated(backend, _backend);
        backend = _backend;
    }
    
    function setTournamentMultiplier(uint8 tier, uint256 multiplier) external onlyOwner {
        require(tier < 4, "Invalid tier");
        require(multiplier <= 10000, "Max 100%");
        tournamentMultipliers[tier] = multiplier;
    }
    
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    
    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function getPoolBalances() external view returns (
        uint256 null_,
        uint256 leviathan,
        uint256 tournament,
        uint256 operations
    ) {
        return (nullPool, leviathanPool, tournamentPool, operationsPool);
    }
    
    function getStats() external view returns (
        uint256 agents,
        uint256 collected,
        uint256 distributed,
        uint256 leviathanSpawns,
        uint256 tournaments,
        uint256 season
    ) {
        return (totalAgents, totalCollected, totalDistributed, leviathanSpawnCount, tournamentCount, currentSeason);
    }
    
    function hasEntered(address agent) external view returns (bool) {
        return hasEnteredSeason[currentSeason][agent];
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // EMERGENCY
    // ═══════════════════════════════════════════════════════════════════════
    
    function emergencyWithdraw(address recipient) external onlyOwner whenPaused {
        require(recipient != address(0), "Invalid recipient");
        uint256 balance = address(this).balance;
        
        nullPool = 0;
        leviathanPool = 0;
        tournamentPool = 0;
        operationsPool = 0;
        
        (bool success, ) = recipient.call{value: balance}("");
        require(success, "Transfer failed");
    }
    
    receive() external payable {
        revert("Use enter() to join");
    }
}
