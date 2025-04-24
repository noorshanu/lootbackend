const express = require('express');
const router = express.Router();
const { openLootbox, getLootboxHistory } = require('../controllers/lootbox.controller');

// Open a lootbox
router.post('/open', openLootbox);

// Get user's lootbox history
router.get('/history/:walletAddress', getLootboxHistory);

module.exports = router; 