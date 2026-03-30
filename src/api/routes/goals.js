'use strict';
const { Router } = require('express');
const { run }    = require('../../db');
const pm         = require('../../portfolio/manager');
const { authenticateToken } = require('../middleware/auth');

const r = Router();

r.use(authenticateToken);

r.get('/', (req, res) => {
  const activeOnly = req.query.all !== 'true';
  res.json(pm.getGoals(req.user.id, !activeOnly));
});

r.post('/', (req, res) => {
  const goal = { ...req.body, user_id: req.user.id };
  const id = pm.upsertGoal(goal);
  res.status(201).json({ id, ...req.body });
});

r.put('/:id', (req, res) => {
  const goal = { ...req.body, id: parseInt(req.params.id), user_id: req.user.id };
  pm.upsertGoal(goal);
  res.json({ id: parseInt(req.params.id), ...req.body });
});

r.delete('/:id', (req, res) => {
  pm.deleteGoal(parseInt(req.params.id), req.user.id);
  res.json({ deleted: true });
});

module.exports = r;
