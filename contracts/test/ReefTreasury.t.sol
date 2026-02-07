// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {ReefTreasury} from "../src/ReefTreasury.sol";

contract ReefTreasuryTest is Test {
    ReefTreasury public treasury;
    
    address public owner = address(this);
    address public backend = address(0xBACE);
    address public agent1 = address(0xA1);
    address public agent2 = address(0xA2);
    address public agent3 = address(0xA3);
    
    uint256 public constant BASE_ENTRY_FEE = 0.5 ether; // 50 MON base (day 1)
    
    function setUp() public {
        treasury = new ReefTreasury(BASE_ENTRY_FEE, backend);
        
        // Fund test agents
        vm.deal(agent1, 100 ether);
        vm.deal(agent2, 100 ether);
        vm.deal(agent3, 100 ether);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SEASON TESTS
    // ═══════════════════════════════════════════════════════════════════════
    
    function test_SeasonStartsAt1() public view {
        assertEq(treasury.currentSeason(), 1);
    }
    
    function test_GetSeasonDay() public {
        assertEq(treasury.getSeasonDay(), 0); // Day 1 (index 0)
        
        // Advance 3 days
        vm.warp(block.timestamp + 3 days);
        assertEq(treasury.getSeasonDay(), 3); // Day 4 (index 3)
        
        // Advance to day 7+
        vm.warp(block.timestamp + 10 days);
        assertEq(treasury.getSeasonDay(), 6); // Caps at day 7 (index 6)
    }
    
    function test_GetCurrentEntryFee_Day1() public view {
        // Day 1: 100% of base = 0.5 ETH
        assertEq(treasury.getCurrentEntryFee(), 0.5 ether);
    }
    
    function test_GetCurrentEntryFee_Day7() public {
        vm.warp(block.timestamp + 6 days);
        // Day 7: 20% of base = 0.1 ETH
        assertEq(treasury.getCurrentEntryFee(), 0.1 ether);
    }
    
    function test_GetCurrentPoolUnlock_Day1() public view {
        // Day 1: 10% unlock
        assertEq(treasury.getCurrentPoolUnlock(), 1000);
    }
    
    function test_GetCurrentPoolUnlock_Day7() public {
        vm.warp(block.timestamp + 6 days);
        // Day 7: 100% unlock
        assertEq(treasury.getCurrentPoolUnlock(), 10000);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ENTRY TESTS
    // ═══════════════════════════════════════════════════════════════════════
    
    function test_Enter_Day1() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        assertTrue(treasury.hasEntered(agent1));
        assertEq(treasury.totalAgents(), 1);
        assertEq(treasury.totalCollected(), fee);
    }
    
    function test_Enter_PoolSplit() public {
        uint256 fee = treasury.getCurrentEntryFee(); // 0.5 ETH day 1
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        // 40% null, 30% leviathan, 20% tournament, 10% ops
        assertEq(treasury.nullPool(), 0.2 ether);       // 40%
        assertEq(treasury.leviathanPool(), 0.15 ether); // 30%
        assertEq(treasury.tournamentPool(), 0.1 ether); // 20%
        assertEq(treasury.operationsPool(), 0.05 ether); // 10%
    }
    
    function test_Enter_RevertAlreadyEntered() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        vm.prank(agent1);
        vm.expectRevert("Already entered this season");
        treasury.enter{value: fee}();
    }
    
    function test_Enter_RevertIncorrectFee() public {
        vm.prank(agent1);
        vm.expectRevert("Incorrect entry fee");
        treasury.enter{value: 0.1 ether}(); // Wrong fee for day 1
    }
    
    function test_Enter_NewSeasonAllowsReentry() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        // Force new season
        treasury.forceNewSeason();
        
        // Should be able to enter again
        uint256 newFee = treasury.getCurrentEntryFee();
        vm.prank(agent1);
        treasury.enter{value: newFee}();
        
        assertEq(treasury.currentSeason(), 2);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // LEVIATHAN TESTS
    // ═══════════════════════════════════════════════════════════════════════
    
    function test_LeviathanSpawn() public {
        vm.prank(backend);
        treasury.recordLeviathanSpawn();
        
        assertEq(treasury.leviathanSpawnCount(), 1);
    }
    
    function test_LeviathanDistribute_Day1_10Percent() public {
        // Three agents enter on day 1
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        vm.prank(agent2);
        treasury.enter{value: fee}();
        vm.prank(agent3);
        treasury.enter{value: fee}();
        
        // Total leviathan pool = 0.15 * 3 = 0.45 ETH
        assertEq(treasury.leviathanPool(), 0.45 ether);
        
        uint256 agent1BalBefore = agent1.balance;
        
        // Day 1 unlock = 10%, so available = 0.045 ETH
        address[] memory winners = new address[](1);
        winners[0] = agent1;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10000; // 100% of available
        
        vm.prank(backend);
        treasury.distributeLeviathan(1, winners, shares, 1000);
        
        // agent1 gets 10% of 0.45 = 0.045 ETH
        assertEq(agent1.balance - agent1BalBefore, 0.045 ether);
        
        // Pool reduced by distributed amount
        assertEq(treasury.leviathanPool(), 0.405 ether);
    }
    
    function test_LeviathanDistribute_Day7_100Percent() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        // Advance to day 7
        vm.warp(block.timestamp + 6 days);
        
        uint256 pool = treasury.leviathanPool();
        uint256 agent1BalBefore = agent1.balance;
        
        address[] memory winners = new address[](1);
        winners[0] = agent1;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10000;
        
        vm.prank(backend);
        treasury.distributeLeviathan(1, winners, shares, 1000);
        
        // Day 7: 100% unlock, full pool distributed
        assertEq(agent1.balance - agent1BalBefore, pool);
        assertEq(treasury.leviathanPool(), 0);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // NULL TESTS
    // ═══════════════════════════════════════════════════════════════════════
    
    function test_NullDistribute_FullPool() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        vm.prank(agent2);
        treasury.enter{value: fee}();
        
        // Null pool = 0.2 * 2 = 0.4 ETH
        assertEq(treasury.nullPool(), 0.4 ether);
        
        uint256 agent1BalBefore = agent1.balance;
        uint256 agent2BalBefore = agent2.balance;
        
        // Null always distributes 100% regardless of day
        address[] memory winners = new address[](2);
        winners[0] = agent1;
        winners[1] = agent2;
        uint256[] memory shares = new uint256[](2);
        shares[0] = 7000; // 70%
        shares[1] = 3000; // 30%
        
        vm.prank(backend);
        treasury.distributeNull(winners, shares, 50000);
        
        // agent1 gets 70% of 0.4 = 0.28 ETH
        assertEq(agent1.balance - agent1BalBefore, 0.28 ether);
        // agent2 gets 30% of 0.4 = 0.12 ETH
        assertEq(agent2.balance - agent2BalBefore, 0.12 ether);
        
        assertEq(treasury.nullPool(), 0);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // TOURNAMENT TESTS
    // ═══════════════════════════════════════════════════════════════════════
    
    function test_TournamentDistribute_Gold_WithUnlock() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        // Tournament pool = 0.1 ETH
        uint256 agent1BalBefore = agent1.balance;
        
        // Day 1: 10% unlock, Gold = 50% of available
        // Available = 0.1 * 10% = 0.01 ETH
        // Prize = 0.01 * 50% = 0.005 ETH
        vm.prank(backend);
        treasury.distributeTournament(1, agent1, 2); // Gold
        
        assertEq(agent1.balance - agent1BalBefore, 0.005 ether);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SEASON END TESTS
    // ═══════════════════════════════════════════════════════════════════════
    
    function test_EndSeason() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        // Fast forward past season duration
        vm.warp(block.timestamp + 7 days);
        
        uint256 remaining = treasury.nullPool() + treasury.leviathanPool() + treasury.tournamentPool();
        uint256 expectedOps = (remaining * 1000) / 10000; // 10%
        uint256 opsBefore = treasury.operationsPool();
        
        vm.prank(backend);
        treasury.endSeason();
        
        assertEq(treasury.currentSeason(), 2);
        assertEq(treasury.operationsPool(), opsBefore + expectedOps);
    }
    
    function test_EndSeason_RevertTooEarly() public {
        vm.prank(backend);
        vm.expectRevert("Season not over");
        treasury.endSeason();
    }
    
    function test_ForceNewSeason() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        // Owner can force new season anytime
        treasury.forceNewSeason();
        
        assertEq(treasury.currentSeason(), 2);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // OPERATIONS TESTS
    // ═══════════════════════════════════════════════════════════════════════
    
    function test_WithdrawOperations() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        // Operations pool = 0.05 ETH (10% of 0.5)
        address recipient = address(0xDEAD);
        
        treasury.withdrawOperations(recipient, 0);
        
        assertEq(recipient.balance, 0.05 ether);
        assertEq(treasury.operationsPool(), 0);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN TESTS
    // ═══════════════════════════════════════════════════════════════════════
    
    function test_SetBaseEntryFee() public {
        treasury.setBaseEntryFee(1 ether);
        assertEq(treasury.baseEntryFee(), 1 ether);
    }
    
    function test_SetPoolSplit() public {
        treasury.setPoolSplit(5000, 2500, 1500, 1000);
        assertEq(treasury.nullSplit(), 5000);
        assertEq(treasury.leviathanSplit(), 2500);
        assertEq(treasury.tournamentSplit(), 1500);
        assertEq(treasury.operationsSplit(), 1000);
    }
    
    function test_SetPoolSplit_RevertBadSum() public {
        vm.expectRevert("Must sum to 10000");
        treasury.setPoolSplit(5000, 3000, 1000, 500);
    }
    
    function test_Pause() public {
        treasury.pause();
        
        vm.prank(agent1);
        vm.expectRevert();
        treasury.enter{value: 0.5 ether}();
    }
    
    function test_EmergencyWithdraw() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        treasury.pause();
        
        address recipient = address(0xDEAD);
        treasury.emergencyWithdraw(recipient);
        
        assertEq(recipient.balance, fee);
        assertEq(treasury.nullPool(), 0);
        assertEq(treasury.leviathanPool(), 0);
        assertEq(treasury.tournamentPool(), 0);
        assertEq(treasury.operationsPool(), 0);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    function test_GetSeasonInfo() public view {
        (uint256 season, uint256 startTime, uint256 day, uint256 entryFee, uint256 poolUnlock) = treasury.getSeasonInfo();
        
        assertEq(season, 1);
        assertGt(startTime, 0);
        assertEq(day, 1); // 1-indexed
        assertEq(entryFee, 0.5 ether);
        assertEq(poolUnlock, 1000); // 10%
    }
    
    function test_GetPoolBalances() public {
        uint256 fee = treasury.getCurrentEntryFee();
        
        vm.prank(agent1);
        treasury.enter{value: fee}();
        
        (uint256 null_, uint256 levi, uint256 tourney, uint256 ops) = treasury.getPoolBalances();
        
        assertEq(null_, 0.2 ether);
        assertEq(levi, 0.15 ether);
        assertEq(tourney, 0.1 ether);
        assertEq(ops, 0.05 ether);
    }
}
