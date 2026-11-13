import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Competition, phoneKey, cleanPhone } from '../server/competition.js';
import * as Quiz from '../server/games/quiz.js';
import { createHuroof } from '../server/games/huroof.js';
import { planTeams, distribute, makeNames, parseParticipantsText, teamColor } from '../server/teams.js';
import { birthdayCode } from '../server/games/lockedPhone.js';
import { solutions } from './robopath-solutions.js';
import { levels } from '../shared/robopath/levels.js';
import { findPath } from '../shared/huroof/hex.js';

const bank = [];
for (const l of ['ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ي']) {
  bank.push({ id: bank.length + 1, letter: l, q: 'Q ' + l, a: 'A ' + l, src: 'app' });
}

function clock(start = Date.UTC(2026, 10, 13, 12, 0, 0)) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

function setup(n = 10) {
  const now = clock();
  const comp = new Competition({ bank, now, timeZone: 'Africa/Casablanca' });
  const lines = [];
  for (let i = 0; i < n; i++) lines.push(`Student ${i}, Génie Informatique, ${(i % 3) + 1}`);
  assert.equal(comp.importParticipants({ text: 'Full Name, Filière, Year\n' + lines.join('\n') }).ok, true);
  assert.equal(comp.generateTeams().ok, false, 'nobody confirmed yet');
  assert.equal(comp.markAllPresent({ present: true }).ok, true);
  return { comp, now };
}

test('team plan: even sizes, 1–4 members, at least 2 teams', () => {
  assert.deepEqual(planTeams(6), [3, 3]);
  assert.deepEqual(planTeams(5), [3, 2]);
  assert.deepEqual(planTeams(2), [1, 1]);
  assert.deepEqual(planTeams(1), [1]);
  assert.deepEqual(planTeams(10), [4, 3, 3]);
  assert.deepEqual(planTeams(16), [4, 4, 4, 4]);
  for (let n = 2; n <= 150; n++) {
    const p = planTeams(n);
    assert.equal(p.reduce((a, b) => a + b, 0), n);
    assert.ok(Math.max(...p) <= 4 && Math.min(...p) >= 1);
    assert.ok(Math.max(...p) - Math.min(...p) <= 1);
    assert.equal(p.length, Math.max(2, Math.ceil(n / 4)));
  }
});

test('seniority seeding: every team gets a senior when possible', () => {
  for (let run = 0; run < 200; run++) {
    const n = 2 + (run % 30);
    const seniors = 1 + (run % n);
    const people = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, year: i < seniors ? 2 + (i % 2) : 1 }));
    const teams = distribute(people);
    const all = teams.flatMap((t) => t.memberIds);
    assert.equal(new Set(all).size, n);
    const withSenior = teams.filter((t) => t.memberIds.some((id) => people.find((p) => p.id === id).year > 1)).length;
    assert.equal(withSenior, Math.min(seniors, teams.length));
  }
});

test('names and colours are unique', () => {
  const names = makeNames(144);
  assert.equal(new Set(names).size, 144);
  const twelve = makeNames(12);
  assert.equal(new Set(twelve.map((n) => n.split(' ')[0])).size, 12);
  const colours = Array.from({ length: 40 }, (_, i) => teamColor(i));
  assert.equal(new Set(colours).size, 40);
});

test('CSV parsing', () => {
  const { rows, errors } = parseParticipantsText('Name;Filière;Year\nAmine B;Génie Civil;2nd Year\nSara;GI;1ère\nBad;GI;5');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].year, 2);
  assert.equal(rows[1].year, 1);
  assert.equal(errors.length, 1);
});

test('full lifecycle: lobby, gauntlet, challenge queue, Huruf, zero-sum stakes', () => {
  const { comp, now } = setup(10);
  assert.equal(comp.generateTeams().ok, true);
  assert.equal(comp.comp.status, 'LOBBY_LOCKED');
  const teams = comp.s.teams;
  assert.equal(teams.length, 3);
  assert.equal(new Set(teams.map((t) => t.joinCode)).size, 3);

  // claim + rename
  assert.equal(comp.claim(teams[0].id).ok, true);
  assert.equal(comp.renameTeam(teams[0].id, { name: '  The   Best  ' }).ok, true);
  assert.equal(teams[0].customName, 'The Best');
  assert.equal(comp.renameTeam(teams[1].id, { name: 'the best' }).ok, false, 'names are unique');
  assert.equal(comp.robopathRun(teams[0].id, { level: 0, program: [] }).ok, false, 'locked before start');

  // countdown
  assert.equal(comp.beginCompetition().ok, true);
  assert.equal(comp.comp.status, 'COUNTDOWN');
  now.advance(3100);
  comp.tick();
  assert.equal(comp.comp.status, 'MAIN_GAMES');

  // team 0 solves every RoboPath level
  const [a, b, c] = teams.map((t) => t.id);
  assert.equal(comp.robopathRun(a, { level: 1, program: solutions.loop }).ok, false, 'level 2 locked');
  assert.equal(comp.robopathRun(a, { level: 0, program: [[{ cmd: 'forward' }]] }).status, 'ended');
  levels.forEach((lvl, i) => {
    const r = comp.robopathRun(a, { level: i, program: solutions[lvl.id] });
    assert.equal(r.ok, true);
    assert.equal(r.status, 'won');
  });
  assert.equal(comp.game(a, 'robopath').points, 100);
  assert.equal(comp.team(a).currentGameIndex, 1);
  assert.equal(comp.game(a, 'locked_phone').status, 'ready');

  // Locked Phone
  assert.equal(comp.lockedAttempt(a, { lock: 0, answer: '1234' }).ok, false, 'not started');
  assert.equal(comp.lockedStart(a).ok, true);
  const wrong = comp.lockedAttempt(a, { lock: 0, answer: '0000' });
  assert.equal(wrong.correct, false);
  assert.equal(comp.lockedAttempt(a, { lock: 0, answer: birthdayCode(now(), 'Africa/Casablanca') }).correct, true);
  assert.equal(comp.lockedHint(a).ok, true);
  assert.equal(comp.lockedAttempt(a, { lock: 1, answer: 'Café Atlas 2019' }).correct, true);
  assert.equal(comp.lockedAttempt(a, { lock: 2, answer: '570' }).correct, true);
  assert.equal(comp.lockedAttempt(a, { lock: 3, answer: 'Lionheart C' }).found, true);
  const lp = comp.game(a, 'locked_phone');
  assert.equal(lp.status, 'completed');
  // 4 locks × 20 + battery bonus ((100 − 5 − 10) / 5 = 17)
  assert.equal(lp.points, 97);
  assert.equal(comp.team(a).currentGameIndex, 2);

  // team b solves 2 levels and gives up
  comp.robopathRun(b, { level: 0, program: solutions['first-steps'] });
  comp.robopathRun(b, { level: 1, program: solutions.loop });
  assert.equal(comp.robopathGiveUp(b).ok, true);
  assert.equal(comp.game(b, 'robopath').points, 22);

  // challenge window freezes everything else
  assert.equal(comp.openChallengeWindow({ minutes: 10 }).ok, true);
  assert.equal(comp.comp.status, 'CHALLENGE_WINDOW');
  assert.ok(comp.s.teams.every((t) => t.currentGameIndex === 3));
  const lb = comp.leaderboard();
  assert.deepEqual(lb.map((r) => r.id), [a, b, c]);

  // upward only
  assert.equal(comp.requestChallenge(a, { defenderId: b }).ok, false);
  const r1 = comp.requestChallenge(c, { defenderId: a });
  assert.equal(r1.ok, true);
  assert.equal(comp.requestChallenge(b, { defenderId: a }).ok, false, 'defender busy');
  // two denials, then auto accept
  assert.equal(comp.respondChallenge(a, { id: r1.challengeId, accept: false }).status, 'DENIED');
  const r2 = comp.requestChallenge(c, { defenderId: a });
  assert.equal(comp.respondChallenge(a, { id: r2.challengeId, accept: false }).status, 'DENIED');
  assert.equal(comp.team(a).denialsRemaining, 0);
  const r3 = comp.requestChallenge(c, { defenderId: a });
  assert.equal(r3.status, 'IN_PROGRESS', 'auto-accepted and started (queue was empty)');
  const live = comp.challenge(r3.challengeId);
  assert.equal(live.rankDelta, 2);
  assert.equal(live.lockedPointStake, 100);

  // b challenges ... a and c are busy; nothing for b
  assert.equal(comp.requestChallenge(b, { defenderId: a }).ok, false);

  // play the Huruf match: the challenger (side 0) wins by owning a full row
  assert.equal(comp.matchAct({ type: 'start' }).ok, true);
  const g = comp.huroof.game;
  const n = g.state.settings.size;
  for (let col = 0; col < n; col++) {
    const i = col; // row 0, left to right
    if (g.state.phase === 'matchOver') break;
    assert.equal(comp.matchAct({ type: 'pick', i }).ok, true);
    assert.equal(comp.buzz(c).accepted, true);
    assert.equal(comp.buzz(a).accepted, false, 'too late');
    assert.equal(comp.matchAct({ type: 'judge', correct: true }).ok, true);
  }
  assert.equal(g.state.phase, 'matchOver');
  assert.equal(g.state.matchWinner, 0);
  assert.ok(findPath(g.state.cells.map((x) => x.o), 0, n));

  const before = { a: comp.totalScore(a), c: comp.totalScore(c) };
  assert.equal(comp.settleMatch().ok, true);
  assert.equal(comp.totalScore(c) - before.c, 100);
  assert.equal(comp.totalScore(a) - before.a, -100);
  assert.equal(comp.challenge(r3.challengeId).status, 'COMPLETED');
  assert.equal(comp.huroof, null);
  assert.equal(comp.requestChallenge(c, { defenderId: a }).ok, false, 'no rematch');

  // queue: two accepted challenges play one after the other
  const ranks = comp.ranks();
  const order = comp.leaderboard().map((r) => r.id);
  const last = order[2];
  const mid = order[1];
  const top = order[0];
  assert.ok(ranks.get(last) > ranks.get(mid));
  const q1 = comp.requestChallenge(mid, { defenderId: top });
  if (q1.ok) {
    comp.respondChallenge(top, { id: q1.challengeId, accept: true });
    assert.equal(comp.challenge(q1.challengeId).status, 'IN_PROGRESS');
    assert.equal(comp.abortMatch({}).ok, true);
    assert.equal(comp.challenge(q1.challengeId).status, 'ABORTED');
  }

  // pending requests auto-accept after the timeout
  const free = comp.leaderboard().map((r) => r.id);
  const q2 = comp.requestChallenge(free[2], { defenderId: free[0] });
  if (q2.ok && comp.challenge(q2.challengeId).status === 'PENDING') {
    now.advance(46000);
    comp.tick();
    assert.equal(comp.challenge(q2.challengeId).autoAccepted, true);
  }

  // window closes
  now.advance(11 * 60000);
  comp.tick();
  assert.equal(comp.windowOpen(), false);
  assert.equal(comp.finishCompetition().ok, true);
  assert.equal(comp.comp.status, 'FINISHED');

  // zero-sum: challenge adjustments sum to 0
  const sum = comp.s.adjustments.filter((x) => x.source === 'challenge').reduce((s, x) => s + x.points, 0);
  assert.equal(sum, 0);

  // views serialize
  for (const v of [comp.hostView(), comp.adminView(), comp.teamView(a)]) JSON.stringify(v);
  // join codes hidden from the big screen after the start
  assert.equal(comp.hostView().teams[0].joinCode, undefined);
});

test('snapshot round trip keeps the live match', () => {
  const { comp, now } = setup(4);
  comp.generateTeams();
  comp.beginCompetition();
  now.advance(3500);
  comp.tick();
  comp.openChallengeWindow({ minutes: 5 });
  const [top, low] = comp.leaderboard().map((r) => r.id);
  const r = comp.requestChallenge(low, { defenderId: top });
  comp.respondChallenge(top, { id: r.challengeId, accept: true });
  comp.matchAct({ type: 'start' });
  comp.matchAct({ type: 'pick', i: 0 });
  const snap = JSON.parse(JSON.stringify(comp.snapshot()));
  const again = new Competition({ snapshot: snap, bank, now });
  assert.ok(again.huroof);
  assert.equal(again.huroof.game.state.sel, 0);
  assert.equal(again.huroof.game.state.phase, 'question');
  assert.equal(again.comp.status, 'CHALLENGE_WINDOW');
});

test('locked phone battery death ends the game and keeps lock points', () => {
  const { comp, now } = setup(2);
  comp.generateTeams();
  comp.beginCompetition();
  now.advance(3500);
  comp.tick();
  const id = comp.s.teams[0].id;
  comp.robopathGiveUp(id);
  comp.updateSettings({ lockedBatteryMinutes: 20 });
  comp.lockedStart(id);
  comp.lockedAttempt(id, { lock: 0, answer: birthdayCode(now(), 'Africa/Casablanca') });
  now.advance(21 * 60000);
  comp.tick();
  const g = comp.game(id, 'locked_phone');
  assert.equal(g.status, 'dead');
  assert.equal(g.points, 20);
  assert.equal(comp.team(id).currentGameIndex, 2);
});

test('skip: a stage can be skipped in each game (no points, next stage opens)', () => {
  const { comp, now } = setup(2);
  comp.generateTeams();
  comp.beginCompetition();
  now.advance(3500);
  comp.tick();
  const id = comp.s.teams[0].id;
  // RoboPath: skip level 1, solve level 2, come back and solve level 1
  assert.equal(comp.robopathSkip(id, { level: 1 }).ok, false, 'level 2 is locked');
  assert.equal(comp.robopathSkip(id, { level: 0 }).ok, true);
  assert.equal(comp.robopathSkip(id, { level: 0 }).ok, false, 'already skipped');
  assert.equal(comp.game(id, 'robopath').points, 0);
  assert.equal(comp.robopathRun(id, { level: 1, program: solutions.loop }).status, 'won');
  assert.equal(comp.game(id, 'robopath').points, 12);
  assert.equal(comp.robopathRun(id, { level: 0, program: solutions['first-steps'] }).solved, true);
  assert.equal(comp.game(id, 'robopath').points, 22);
  assert.equal(comp.robopathSkip(id, { level: 0 }).ok, false, 'solved levels cannot be skipped');
  for (let i = 2; i < levels.length; i++) assert.equal(comp.robopathSkip(id, { level: i }).ok, true);
  assert.equal(comp.team(id).currentGameIndex, 1, 'skipping the last level ends the game');
  assert.equal(comp.game(id, 'robopath').status, 'completed');
  assert.equal(comp.game(id, 'robopath').points, 22);

  // Locked Phone: skip lock 1, open lock 2, skip the rest
  assert.equal(comp.lockedSkip(id).ok, false, 'phone not started');
  comp.lockedStart(id);
  assert.equal(comp.lockedSkip(id).stage, 1);
  assert.equal(comp.game(id, 'locked_phone').points, 0);
  assert.equal(comp.teamView(id).lockedPhone.secretNote, null);
  assert.equal(comp.lockedAttempt(id, { lock: 1, answer: 'atlas2019' }).correct, true);
  assert.equal(comp.game(id, 'locked_phone').points, 20);
  assert.ok(comp.teamView(id).lockedPhone.secretNote);
  assert.equal(comp.lockedSkip(id).stage, 3);
  assert.ok(comp.teamView(id).lockedPhone.memo);
  const end = comp.lockedSkip(id);
  assert.equal(end.finished, true);
  const g = comp.game(id, 'locked_phone');
  assert.equal(g.status, 'completed');
  assert.equal(g.state.endReason, 'finished');
  assert.equal(g.points, 20, 'no battery bonus when the last lock is skipped');
  assert.equal(comp.teamView(id).lockedPhone.flag, null);
  assert.equal(comp.team(id).currentGameIndex, 2);
  // survives a save / load
  const again = new Competition({ snapshot: JSON.parse(JSON.stringify(comp.snapshot())), bank, now });
  assert.deepEqual(again.game(id, 'locked_phone').state.skipped, [true, false, true, true]);
  assert.deepEqual(again.game(id, 'robopath').state.skipped.slice(0, 3), [false, false, true]);
});

test('registration, check-in QR and teams from confirmed players only', () => {
  const now = clock();
  const comp = new Competition({ bank, now, secret: 'test-secret' });
  // phone numbers
  assert.equal(cleanPhone('06 12-34 56 78'), '0612345678');
  assert.equal(cleanPhone('00212 612345678'), '+212612345678');
  assert.equal(cleanPhone('abc'), '');
  assert.equal(phoneKey('+212612345678'), phoneKey('0612345678'));

  const form = (i, extra = {}) => ({ fullName: `Student Number${i}`, phone: `06000000${String(i).padStart(2, '0')}`, filiere: 'GI', year: (i % 3) + 1, ...extra });
  assert.equal(comp.register({ ...form(1), fullName: 'Solo' }).ok, false, 'first and last name');
  assert.equal(comp.register({ ...form(1), phone: '12' }).ok, false, 'bad phone');
  assert.equal(comp.register({ ...form(1), filiere: '' }).ok, false, 'field required');
  const r1 = comp.register(form(1));
  assert.equal(r1.ok, true);
  assert.equal(r1.checkedIn, false);
  assert.equal(comp.register({ ...form(2), phone: '+212600000001' }).ok, false, 'same phone, other format');
  for (let i = 2; i <= 6; i++) assert.equal(comp.register(form(i)).ok, true);
  assert.equal(comp.s.participants.length, 6);
  assert.ok(comp.s.participants.every((p) => p.source === 'self' && !p.checkedInAt));

  // check-in is closed until the admin opens it
  const key = comp.checkinKey();
  assert.equal(comp.checkIn({ key, phone: '0600000001' }).ok, false);
  assert.equal(comp.setRegistration({ checkinOpen: true }).ok, true);
  assert.equal(comp.tick(), false);
  assert.equal(comp.checkIn({ key: 'wrongwrong', phone: '0600000001' }).code, 410);
  assert.equal(comp.checkIn({ key, phone: '0699999999' }).code, 404);
  // one tap with the proof kept at registration
  const c1 = comp.checkIn({ key, participantId: r1.participantId, proof: r1.proof });
  assert.equal(c1.ok, true);
  assert.equal(c1.already, false);
  assert.equal(comp.checkIn({ key, participantId: r1.participantId, proof: 'x'.repeat(22) }).code, 404, 'forged proof');
  assert.equal(comp.checkIn({ key, participantId: r1.participantId, proof: r1.proof }).already, true);
  // by phone number, written differently
  assert.equal(comp.checkIn({ key, phone: '+212 600000002' }).ok, true);
  // the code rotates; an old code works for a couple of minutes only
  now.advance(2 * 60 * 1000);
  assert.equal(comp.tick(), true, 'screens redraw the QR');
  assert.equal(comp.checkIn({ key, phone: '0600000003' }).ok, true);
  now.advance(60 * 1000);
  assert.equal(comp.checkIn({ key, phone: '0600000004' }).code, 410);
  assert.equal(comp.checkIn({ key: comp.checkinKey(), phone: '0600000004' }).ok, true);
  // registering on site with the check-in code confirms at once, even if online registration is closed
  comp.setRegistration({ registrationOpen: false });
  assert.equal(comp.register(form(7)).ok, false);
  const onSite = comp.register({ ...form(7), checkinKey: comp.checkinKey() });
  assert.equal(onSite.ok, true);
  assert.equal(onSite.checkedIn, true);
  // admin adds someone at the desk: confirmed
  assert.equal(comp.addParticipant({ fullName: 'Walk In', filiere: 'GC', year: 2 }).ok, true);
  assert.equal(comp.s.participants.filter((p) => p.checkedInAt).length, 6);
  // the host never sees phone numbers, the admin does
  const host = JSON.stringify(comp.hostView());
  assert.ok(!host.includes('0600000001'));
  assert.equal(comp.hostView().registration.confirmed, 6);
  assert.ok(comp.hostView().registration.checkinKey);
  assert.ok(JSON.stringify(comp.adminView()).includes('0600000001'));
  // teams only from confirmed people
  assert.equal(comp.generateTeams().ok, true);
  const placed = comp.s.participants.filter((p) => p.teamId);
  assert.equal(placed.length, 6);
  assert.ok(placed.every((p) => p.checkedInAt));
  assert.equal(comp.comp.checkinOpen, false);
  assert.equal(comp.register(form(9)).ok, false, 'registration closed once teams exist');
});

test('N7 Quiz: third game, server clock, original scoring, score hidden until the end', () => {
  const { comp, now } = setup(4);
  comp.generateTeams();
  comp.beginCompetition();
  now.advance(3100);
  comp.tick();
  const id = comp.s.teams[0].id;
  assert.equal(comp.quizStart(id).ok, false, 'not before the Locked Phone');
  comp.robopathGiveUp(id);
  comp.lockedGiveUp(id);
  assert.equal(comp.team(id).currentGameIndex, 2);
  assert.equal(comp.game(id, 'quiz').status, 'ready');
  const start = comp.quizStart(id);
  assert.equal(start.ok, true);
  assert.equal(start.quiz.phase, 'play');
  assert.equal(start.quiz.total, 20);
  const g = comp.game(id, 'quiz');
  // the deck follows the original mix
  const mix = { 1: 0, 2: 0, 3: 0 };
  for (const it of g.state.deck) mix[it.d] += 1;
  assert.deepEqual(mix, { 1: 8, 2: 8, 3: 4 });
  assert.equal(Quiz.MAX_TOTAL, 280);
  // no answers leak to the team
  const tv = JSON.stringify(comp.teamView(id).quiz);
  assert.ok(!tv.includes('"a":'));
  assert.equal(comp.quizAnswer(id, { qid: 0, choice: 0 }).ok, false, 'too early, countdown');
  now.advance(Quiz.COUNTDOWN_MS);
  // answer question 0 correctly after 5 s → 10 × mult × (0.4 + 0.6 × 15/20)
  now.advance(5000);
  const item = g.state.deck[0];
  const correctShown = (() => {
    // find the shown position of the correct answer through a scratch copy
    const copy = Quiz.cleanQuizState(JSON.parse(JSON.stringify(g.state)));
    for (let k = 0; k < item.order.length; k++) {
      const c2 = JSON.parse(JSON.stringify(copy));
      Quiz.answer(c2, { qid: 0, choice: k }, now());
      if (c2.answers[0].points > 0) return k;
    }
    return -1;
  })();
  assert.ok(correctShown >= 0);
  const r = comp.quizAnswer(id, { qid: 0, choice: correctShown, tabSwitches: 2 });
  assert.equal(r.ok, true);
  const expect = Quiz.calcScore(true, 15, Quiz.MULT[item.d]);
  assert.equal(g.state.score, expect);
  assert.equal(g.points, 0, 'hidden until the end');
  assert.equal(comp.teamView(id).quiz.score, undefined);
  assert.equal(g.state.switches, 2);
  // a skip (null) and a stale question id are harmless
  now.advance(Quiz.GAP_MS + 1000);
  assert.equal(comp.quizAnswer(id, { qid: 1, choice: null }).ok, true);
  assert.equal(comp.quizAnswer(id, { qid: 1, choice: 0 }).ok, true);
  assert.equal(g.state.answers.length, 2);
  // the team walks away: the server clock times out the remaining questions
  now.advance(25 * 60 * 1000);
  comp.tick();
  assert.equal(g.status, 'completed');
  assert.equal(g.state.answers.length, 20);
  assert.equal(g.points, expect);
  assert.equal(comp.team(id).currentGameIndex, 3);
  assert.equal(comp.teamView(id).quiz.phase, 'done');
  assert.equal(comp.teamView(id).quiz.score, expect);
  assert.equal(comp.totalScore(id), Math.round((comp.game(id, 'robopath').points + comp.game(id, 'locked_phone').points + expect) * 10) / 10);
  // snapshot round trip keeps the quiz
  const again = new Competition({ bank, now, snapshot: JSON.parse(JSON.stringify(comp.snapshot())) });
  assert.equal(again.game(id, 'quiz').points, expect);
  assert.equal(again.game(id, 'quiz').state.answers.length, 20);
});

test('main games: the challenge phase opens by itself after 90 minutes', () => {
  const { comp, now } = setup(4);
  comp.generateTeams();
  comp.beginCompetition();
  now.advance(3100);
  comp.tick();
  assert.equal(comp.comp.mainGamesEndsAt, comp.comp.startedAt + 90 * 60000);
  const id = comp.s.teams[1].id;
  comp.robopathGiveUp(id);
  comp.lockedGiveUp(id);
  now.advance(10 * 60000);
  assert.equal(comp.extendMainGames({ minutes: 5 }).ok, true);
  assert.equal(comp.comp.mainGamesEndsAt, comp.comp.startedAt + 95 * 60000);
  assert.equal(comp.extendMainGames({ minutes: -5 }).ok, true);
  now.advance(80 * 60000 - 60000);
  assert.equal(comp.quizStart(id).ok, true);
  now.advance(59000);
  comp.tick();
  assert.equal(comp.comp.status, 'MAIN_GAMES');
  now.advance(1500);
  comp.tick();
  assert.equal(comp.comp.status, 'CHALLENGE_WINDOW');
  assert.ok(comp.s.teams.every((t) => t.currentGameIndex === 3));
  const q = comp.game(id, 'quiz');
  assert.equal(q.status, 'abandoned', 'a quiz in progress is frozen');
  assert.equal(q.points, q.state.score);
  assert.equal(comp.teamView(id).quiz.phase, 'done');
  assert.ok(comp.windowOpen());
});

test('Huruf: when the answering side runs out of time, the question passes to the other side', () => {
  let t = 1000;
  const now = () => t;
  const g = createHuroof({ bank, settings: { answerTime: 8 }, rand: () => 0.3, now });
  g.act('start');
  g.act('pick', { i: 0 });
  assert.equal(g.buzz(0).accepted, true);
  assert.equal(g.state.phase, 'answer');
  assert.equal(g.state.turn, 0);
  t += 7000;
  assert.equal(g.tick(), false);
  t += 1500;
  assert.equal(g.tick(), true);
  assert.equal(g.state.turn, 1, 'other side answers');
  assert.equal(g.state.phase, 'answer');
  assert.equal(g.state.fx.type, 'timeout');
  assert.ok(g.state.timer && g.state.timer.ends > t);
  t += 9000;
  assert.equal(g.tick(), true);
  assert.equal(g.state.phase, 'missed', 'both sides missed');
  assert.equal(g.tick(), false);
  // undo brings the turn back
  assert.equal(g.act('undo').ok, true);
  assert.equal(g.state.turn, 1);
});

test('a save from before the quiz loads cleanly', () => {
  const { comp, now } = setup(4);
  comp.generateTeams();
  comp.beginCompetition();
  now.advance(3100);
  comp.tick();
  const id = comp.s.teams[0].id;
  comp.robopathGiveUp(id);
  comp.lockedGiveUp(id);
  const old = JSON.parse(JSON.stringify(comp.snapshot()));
  old.games = old.games.filter((g) => g.gameKey !== 'quiz');
  for (const p of old.participants) { delete p.phone; delete p.checkedInAt; delete p.source; }
  delete old.competition.mainGamesEndsAt;
  const again = new Competition({ bank, now, snapshot: old });
  assert.equal(again.game(id, 'quiz').status, 'ready');
  assert.equal(again.team(id).currentGameIndex, 2);
  assert.equal(again.quizStart(id).ok, true);
  assert.ok(again.comp.mainGamesEndsAt > now());
  assert.ok(again.s.participants.every((p) => p.phone === '' && p.checkedInAt === null && p.source === 'admin'));
});
