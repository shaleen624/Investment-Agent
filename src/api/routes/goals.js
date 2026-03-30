'use strict';
const { Router } = require('express');
const { run }    = require('../../db');
const pm         = require('../../portfolio/manager');

const r = Router();

r.get('/', (req, res) => {
  const activeOnly = req.query.all !== 'true';
  res.json(pm.getGoals(!activeOnly));
});

r.post('/', (req, res) => {
  const id = pm.upsertGoal(req.body);
  res.status(201).json({ id, ...req.body });
});

r.put('/:id', (req, res) => {
  pm.upsertGoal({ ...req.body, id: parseInt(req.params.id) });
  res.json({ id: parseInt(req.params.id), ...req.body });
});

r.delete('/:id', (req, res) => {
  run('DELETE FROM goals WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ deleted: true });
});

module.exports = r;
