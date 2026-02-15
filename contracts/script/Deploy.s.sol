// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ReefTreasury} from "../src/ReefTreasury.sol";

contract DeployReefTreasury is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address backend = vm.envAddress("BACKEND_ADDRESS");
        uint256 baseEntryFee = vm.envOr("BASE_ENTRY_FEE", uint256(0.1 ether));
        
        vm.startBroadcast(deployerPrivateKey);
        
        ReefTreasury treasury = new ReefTreasury(baseEntryFee, backend);
        
        console.log("ReefTreasury deployed to:", address(treasury));
        console.log("Owner:", treasury.owner());
        console.log("Backend:", treasury.backend());
        console.log("Base Entry Fee:", treasury.baseEntryFee());
        
        vm.stopBroadcast();
    }
}
