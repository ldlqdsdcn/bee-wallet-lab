// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 固定总量 ERC-20：构造时把全部份额铸给部署者，之后不能再增发。
contract BeeFixedERC20 is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 initialSupply_) ERC20(name_, symbol_) {
        require(decimals_ <= 18, "decimals too high");
        require(initialSupply_ > 0, "supply is zero");
        _tokenDecimals = decimals_;
        _mint(msg.sender, initialSupply_);
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }
}
