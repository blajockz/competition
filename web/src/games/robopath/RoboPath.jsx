// RoboPath, the first game of the gauntlet (ported from the stand-alone game).
// The ghost is animated on this device; the server replays every finished run
// with the same engine and is the only one that awards points.
import { useEffect, useMemo, useRef, useState } from 'react';
import { countCommands, createRun, emptyProgram, parseLevel, sanitizeProgram, step } from '@shared/robopath/engine.js';
import { levels } from '@shared/robopath/levels.js';
import { sfx } from '../../lib/audio.js';
import { toast, useConfirm } from '../../components/common.jsx';
import { MOODS, PONDER_MS, STAR_FLASH_MS, getMood } from './mood.js';
import { HELP_TEXT } from './helpText.js';
import PixelGhost from './PixelGhost.jsx';
import {
  ChevronIcon, EraseIcon, ForwardIcon, PauseIcon, PlayIcon, SoundOffIcon, SoundOnIcon,
  StarIcon, StopIcon, TrashIcon, TurnLeftIcon, TurnRightIcon,
} from './icons.jsx';
import styles from './Game.module.css';
import './robopath.css';

const STEP_MS = 420; // time per move at speed x1
const END_DELAY_MS = 900; // pause before the end window, after the last star
const SAVE_DELAY_MS = 1200; // drafts are saved a moment after the last change
const SPEEDS = [1, 2, 3];
const FUNCTION_NAMES = ['F1', 'F2'];

// the game's sound names → the platform's audio manager
const SOUND = { win: 'levelWin', victory: 'fanfare' };
const playSound = (name) => sfx.play(SOUND[name] || name);

const COMMAND_INFO = {
  forward: { label: 'Forward', content: <ForwardIcon /> },
  left: { label: 'Turn left', content: <TurnLeftIcon /> },
  right: { label: 'Turn right', content: <TurnRightIcon /> },
  f1: { label: 'Call F1', content: 'F1' },
  f2: { label: 'Call F2', content: 'F2' },
};

const FAIL_MESSAGES = {
  fell: 'Oops! The ghost left the path. Change the program and try again.',
  ended: 'The program ended, but some stars are left.',
  limit: 'Too many steps. Is the program looping forever?',
};

const pad = (number) => String(number).padStart(2, '0');

function describeSlot(fn, slot, command) {
  const name = `${FUNCTION_NAMES[fn]} slot ${slot + 1}`;
  if (!command) return `${name}: empty`;
  const condition = command.color ? ` on ${command.color}` : '';
  return `${name}: ${COMMAND_INFO[command.cmd].label}${condition}`;
}

/**
 * @param data        the team's RoboPath state from the server
 *                    { status, points, solved[], skipped[], programs[], levelPoints[] }
 * @param act         (action, payload) => Promise<{ok, ...}>
 * @param team        { name, colorHex }
 * @param onContinue  called when the team leaves the finished game
 */
export default function RoboPath({ data, act, team, onContinue }) {
  const [programs, setPrograms] = useState(() => levels.map((level, i) => sanitizeProgram(level, data.programs?.[i])));
  const [localSolved, setLocalSolved] = useState(() => levels.map(() => false));
  const firstOpen = () => {
    const i = levels.findIndex((_, k) => !data.solved[k] && !data.skipped[k]);
    return i === -1 ? levels.length - 1 : i;
  };
  const [levelIndex, setLevelIndex] = useState(firstOpen);
  const [cursor, setCursor] = useState({ fn: 0, slot: 0 }); // selected slot
  const [brush, setBrush] = useState(null); // colour condition for new commands
  const [run, setRun] = useState(null); // engine state, or null before a run
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showHelp, setShowHelp] = useState(false);
  const [helpLanguage, setHelpLanguage] = useState('en');
  const [soundOn, setSoundOn] = useState(!sfx.muted);
  const [starCount, setStarCount] = useState(0); // stars taken in this run
  const [flashing, setFlashing] = useState(false); // celebrating a star
  const [pondering, setPondering] = useState(false); // empty program for a while
  const [showEnd, setShowEnd] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [confirmEl, ask] = useConfirm();

  useEffect(() => sfx.subscribe((muted) => setSoundOn(!muted)), []);

  const solved = levels.map((_, i) => !!data.solved[i] || localSolved[i]);
  const skipped = levels.map((_, i) => !!data.skipped[i] && !solved[i]);
  const isOpen = (i) => i === 0 || solved[i - 1] || skipped[i - 1];
  const over = data.status !== 'playing'; // the server closed the game (all levels done, or the phase ended)
  const allSolved = solved.every(Boolean);

  const level = levels[levelIndex];
  const parsed = useMemo(() => parseLevel(level), [level]);
  const program = programs[levelIndex];
  const view = useMemo(() => run ?? createRun(parsed), [run, parsed]);

  const status = run ? run.status : 'ready';
  const won = status === 'won';
  const paused = status === 'running' && !playing;
  const hasCommands = countCommands(program) > 0;
  const hasF2 = level.slots[1] > 0;
  const hasColors = parsed.colors.length > 1;
  const collected = parsed.stars.length - view.stars.length;
  const isLastLevel = levelIndex === levels.length - 1;
  const canGoNext = !isLastLevel && (solved[levelIndex] || skipped[levelIndex]);
  const locked = over || playing; // no editing
  const mood = getMood({ status, hasCommands, starFlash: flashing, pondering, isLastLevel: isLastLevel && allSolved });

  // Load every ghost animation early, so changing mood is instant
  useEffect(() => {
    Object.values(MOODS).forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  /* ---- talking to the server ---- */
  const actRef = useRef(act);
  actRef.current = act;
  const saveTimer = useRef(null);
  const dirty = useRef(null); // { level, program } waiting to be saved

  function flushSave() {
    clearTimeout(saveTimer.current);
    const job = dirty.current;
    dirty.current = null;
    if (job) actRef.current('robopathSave', job);
  }
  function queueSave(index, next) {
    dirty.current = { level: index, program: next };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DELAY_MS);
  }
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  /** Sends a finished run to the server, which replays it and scores it. */
  async function report(index, finalProgram, localStatus) {
    clearTimeout(saveTimer.current);
    dirty.current = null;
    let res = await actRef.current('robopathRun', { level: index, program: finalProgram });
    if (!res.ok && (res.status === 0 || res.status === 429) && localStatus === 'won') {
      // a solved level must not be lost to a network blip: try once more
      await new Promise((r) => setTimeout(r, res.status === 429 ? Math.min(5000, (res.retryAfter || 2) * 1000) : 1500));
      res = await actRef.current('robopathRun', { level: index, program: finalProgram });
    }
    if (!res.ok && localStatus === 'won') {
      setLocalSolved((list) => list.map((v, i) => (i === index ? false : v)));
      toast(`The level was not saved: ${res.error} Press play again.`, 'error');
    }
  }

  // The run loop: one ghost action per tick while playing
  useEffect(() => {
    if (!playing || !run) return undefined;

    const timer = setTimeout(() => {
      const next = step(parsed, program, run);
      const gotStar = next.stars.length < run.stars.length;

      // One sound per action, at the moment it happens on the board
      if (gotStar) playSound('star');
      else if (next.x !== run.x || next.y !== run.y) playSound('step');
      else if (next.dir !== run.dir) playSound('turn');

      if (next.status === 'fell') playSound('fall');
      if (next.status === 'ended' || next.status === 'limit') playSound('fail');
      if (next.status === 'won') playSound('win');

      // The mascot celebrates each star, if the run goes on
      if (gotStar && next.status === 'running') {
        setStarCount((count) => count + 1);
        setFlashing(true);
      }

      setRun(next);

      if (next.status !== 'running') {
        setPlaying(false);
        if (next.status === 'won') {
          setLocalSolved((list) => list.map((v, i) => (i === levelIndex ? true : v)));
        }
        report(levelIndex, program, next.status);
      }
    }, STEP_MS / speed);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, run, speed, parsed, program, levelIndex]);

  // End the star celebration after a short moment. A new star restarts it.
  useEffect(() => {
    if (!flashing) return undefined;
    const timer = setTimeout(() => setFlashing(false), STAR_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashing, starCount]);

  // An empty program for a while: the mascot starts thinking
  useEffect(() => {
    if (status !== 'ready' || hasCommands) return undefined;
    const timer = setTimeout(() => setPondering(true), PONDER_MS);
    return () => {
      clearTimeout(timer);
      setPondering(false);
    };
  }, [status, hasCommands, levelIndex]);

  // The game is over (every level solved or skipped, or the phase ended):
  // let a running animation finish, then show the end window.
  useEffect(() => {
    if (!over || playing) return undefined;
    const timer = setTimeout(() => {
      setShowEnd(true);
      playSound(allSolved ? 'victory' : 'level');
    }, won ? END_DELAY_MS : 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over, playing]);

  function stopRun() {
    setPlaying(false);
    setRun(null);
    setFlashing(false);
  }

  function handleStop() {
    stopRun();
    playSound('stop');
  }

  function selectSlot(target) {
    setCursor(target);
    playSound('tap');
  }

  function selectBrush(color) {
    setBrush(color);
    playSound('tap');
  }

  function toggleSound() {
    sfx.setMuted(soundOn);
    playSound('tap'); // only heard when turning sound on
  }

  function openHelp() {
    setShowHelp(true);
    playSound('tap');
  }

  function openLevel(index) {
    if (index < 0 || index >= levels.length || !isOpen(index)) return;
    flushSave();
    stopRun();
    setLevelIndex(index);
    setCursor({ fn: 0, slot: 0 });
    setBrush(null);
    playSound('level');
  }

  function updateProgram(change) {
    if (over) return;
    stopRun();
    const next = sanitizeProgram(level, change(program));
    setPrograms((list) => list.map((saved, index) => (index === levelIndex ? next : saved)));
    queueSave(levelIndex, next);
  }

  function setSlot(target, value) {
    updateProgram((saved) =>
      saved.map((slots, fn) => slots.map((command, slot) => (fn === target.fn && slot === target.slot ? value : command))));
  }

  function placeCommand(cmd) {
    if (locked) return;
    setSlot(cursor, { cmd, color: hasColors ? brush : null });
    playSound('place');

    // Move on to the next slot, continuing into F2 after the end of F1
    if (cursor.slot + 1 < level.slots[cursor.fn]) {
      setCursor({ fn: cursor.fn, slot: cursor.slot + 1 });
    } else if (cursor.fn === 0 && hasF2) {
      setCursor({ fn: 1, slot: 0 });
    }
  }

  // Works like backspace: clears the selected slot, or the one before it
  function eraseSlot() {
    if (locked) return;
    if (program[cursor.fn][cursor.slot]) {
      setSlot(cursor, null);
      playSound('erase');
    } else if (cursor.slot > 0) {
      const previous = { fn: cursor.fn, slot: cursor.slot - 1 };
      setSlot(previous, null);
      setCursor(previous);
      playSound('erase');
    }
  }

  function clearProgram() {
    if (locked) return;
    updateProgram(() => emptyProgram(level));
    setCursor({ fn: 0, slot: 0 });
    playSound('clear');
  }

  function handlePlay() {
    if (over) return;
    if (playing) {
      setPlaying(false); // pause
      playSound('pause');
    } else if (paused) {
      setPlaying(true); // resume
      playSound('start');
    } else if (hasCommands) {
      setRun(createRun(parsed)); // start from the beginning
      setStarCount(0);
      setPlaying(true);
      playSound('start');
    }
  }

  function cycleSpeed() {
    setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
    playSound('tap');
  }

  // "Skip": the team does not know this level. No points for it, the next one opens.
  async function skipLevel() {
    if (over || skipping || solved[levelIndex] || skipped[levelIndex]) return;
    const index = levelIndex;
    const yes = await ask({
      title: `Skip level ${index + 1}?`,
      text: isLastLevel
        ? `You get 0 of its ${data.levelPoints[index]} points. This is the last level: skipping it ends RoboPath and you move on to the next game.`
        : `You get 0 of its ${data.levelPoints[index]} points and the next level opens. You can come back and solve it later, until you finish RoboPath.`,
      confirmLabel: 'Skip level',
      danger: true,
    });
    if (!yes) return;
    setSkipping(true);
    flushSave();
    stopRun();
    const res = await act('robopathSkip', { level: index });
    setSkipping(false);
    if (!res.ok) {
      toast(res.error, 'error');
      return;
    }
    playSound('level');
    if (index < levels.length - 1) {
      setLevelIndex(index + 1);
      setCursor({ fn: 0, slot: 0 });
      setBrush(null);
    }
  }

  let message = level.hint;
  if (won) {
    message = isLastLevel ? 'Last level complete. Well played!' : `Level complete! +${data.levelPoints[levelIndex]} points`;
  } else if (FAIL_MESSAGES[status]) {
    message = FAIL_MESSAGES[status];
  } else if (playing) {
    message = 'Running...';
  } else if (paused) {
    message = 'Paused. Press play to continue.';
  } else if (skipped[levelIndex]) {
    message = `Skipped. Solve it now to win its ${data.levelPoints[levelIndex]} points. ${level.hint}`;
  }

  let playLabel = 'Run program';
  if (playing) playLabel = 'Pause';
  else if (paused) playLabel = 'Resume';

  const commands = ['forward', 'left', 'right', 'f1', ...(hasF2 ? ['f2'] : [])];
  const points = levels.reduce((sum, _, i) => sum + (solved[i] ? data.levelPoints[i] : 0), 0);
  const canSkip = !over && !solved[levelIndex] && !skipped[levelIndex];

  return (
    <>
    <div className="rp-root">
      <main className={styles.page}>
        <header className={`${styles.card} ${styles.topbar}`}>
          <div className={styles.brand}>
            <PixelGhost className={styles.brandGhost} />
            <h1>RoboPath</h1>
          </div>

          <div className={styles.levelNav}>
            <button className={styles.btn} onClick={() => openLevel(levelIndex - 1)} disabled={levelIndex === 0} aria-label="Previous level">
              <ChevronIcon direction="left" />
            </button>

            <span className={styles.levelName} aria-live="polite">Level {pad(levelIndex + 1)}</span>

            <button
              className={styles.btn}
              onClick={() => openLevel(levelIndex + 1)}
              disabled={!canGoNext}
              aria-label="Next level"
              title={canGoNext || isLastLevel ? undefined : 'Finish or skip this level to unlock the next one'}
            >
              <ChevronIcon direction="right" />
            </button>
          </div>

          <div className={styles.starCount} aria-label={`${collected} of ${parsed.stars.length} stars collected`}>
            <span className={styles.gold}><StarIcon /></span>
            {collected}/{parsed.stars.length}
          </div>

          <div
            className={styles.pips}
            role="img"
            aria-label={`${solved.filter(Boolean).length} of ${levels.length} levels solved, ${skipped.filter(Boolean).length} skipped`}
          >
            {levels.map((item, index) => (
              <span
                key={item.id}
                className={`${styles.pip} ${solved[index] ? styles.pipSolved : ''} ${skipped[index] ? 'rp-pip-skipped' : ''} ${index === levelIndex ? styles.pipCurrent : ''}`}
              />
            ))}
          </div>

          <div className="rp-score" style={{ '--team': team?.colorHex || '#7658b5' }} title={team?.name} data-testid="rp-points">
            <span className="rp-score-team">{team?.name}</span>
            <b>{points}</b><small>/100</small>
          </div>

          <div className="rp-logos">
            <img src="/logos/n7gd.png" alt="N7GD, the game dev club" className={styles.logo} />
            <img src="/logos/n7sec.png" alt="N7SEC, the security club" className={`${styles.logo} rp-logo-dark`} />
          </div>

          <button
            className={`${styles.btn} ${styles.soundButton}`}
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label="Sound"
            title={soundOn ? 'Sound on' : 'Sound off'}
          >
            {soundOn ? <SoundOnIcon /> : <SoundOffIcon />}
          </button>

          <button className={`${styles.btn} ${styles.helpButton}`} onClick={openHelp} aria-label="How to play">?</button>
        </header>

        <div className={styles.main}>
          {/* Left: the ghost and what it says */}
          <aside className={styles.mascot} data-testid="mascot">
            <div
              className={`${styles.card} ${styles.bubble} ${won ? styles.bubbleWon : ''} ${FAIL_MESSAGES[status] ? styles.bubbleFail : ''}`}
              role="status"
            >
              <h2>{level.name} <span className="rp-level-points">{data.levelPoints[levelIndex]} pts</span></h2>
              <p>{message}</p>

              {won && !isLastLevel && !over && (
                <button className={`${styles.btn} ${styles.go}`} onClick={() => openLevel(levelIndex + 1)}>Next level</button>
              )}
              {canSkip && !won && !playing && (
                <button className={`${styles.btn} rp-skip`} onClick={skipLevel} disabled={skipping} data-testid="rp-skip">
                  Skip level
                </button>
              )}
            </div>

            {/* The animated ghost: its mood follows what happens in the game */}
            <div className={styles.mascotGif} data-testid="mascot-mood" data-mood={mood}>
              <img key={mood} src={MOODS[mood]} alt="" width={128} height={128} />
            </div>
          </aside>

          {/* Centre: the board */}
          <section
            className={`${styles.card} ${styles.boardCard}`}
            aria-label="Game board"
            data-testid="board"
          >
            <div className={styles.boardArea}>
              <div
                className={styles.board}
                style={{ "--cols": parsed.cols, "--rows": parsed.rows }}
                role="img"
                aria-label={`Board with ${parsed.stars.length} stars. Ghost at column ${
                  view.x + 1
                }, row ${view.y + 1}.`}
              >
                {parsed.tiles.map((color, index) => (
                  <div key={index} className={styles.cell}>
                    {color && (
                      <div className={`${styles.tile} ${styles[color]}`}>
                        {view.stars.includes(index) && (
                          <span className={styles.star}>
                            <StarIcon />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <div
                  className={`${styles.ghost} ${
                    status === "fell" ? styles.ghostFell : ""
                  }`}
                  style={{ "--x": view.x, "--y": view.y }}
                  data-testid="ghost"
                  data-x={view.x}
                  data-y={view.y}
                  data-dir={view.dir}
                >
                  <PixelGhost className={styles.sprite} />
                  {/* A small arrow on the side the ghost is facing */}
                  <span
                    className={styles.facing}
                    style={{ transform: `rotate(${view.dir * 90}deg)` }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Right: the program and the controls */}
          <div className={styles.controls} data-testid="controls">
            <section
              className={`${styles.card} ${styles.panel}`}
              aria-label="Functions"
            >
              {program.map((slots, fn) =>
                slots.length === 0 ? null : (
                  <div key={fn} className={styles.functionRow}>
                    <span className={styles.functionName}>
                      {FUNCTION_NAMES[fn]}
                    </span>

                    <div
                      className={styles.slots}
                      style={{ "--per-row": slots.length <= 6 ? slots.length : 4 }}
                    >
                      {slots.map((command, slot) => {
                        const selected =
                          !locked && cursor.fn === fn && cursor.slot === slot;
                        const active =
                          run?.active?.fn === fn && run.active.slot === slot;

                        return (
                          <button
                            key={slot}
                            className={`${styles.slot} ${
                              command?.color ? styles[command.color] : ""
                            } ${command ? styles.filled : ""} ${
                              selected ? styles.selected : ""
                            } ${active ? styles.active : ""}`}
                            onClick={() => selectSlot({ fn, slot })}
                            disabled={locked}
                            aria-pressed={selected}
                            aria-label={describeSlot(fn, slot, command)}
                          >
                            {command && COMMAND_INFO[command.cmd].content}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
            </section>

            <section
              className={`${styles.card} ${styles.panel}`}
              aria-label="Commands"
            >
              <div className={styles.row}>
                {commands.map((cmd) => (
                  <button
                    key={cmd}
                    className={`${styles.btn} ${
                      hasColors && brush ? styles[brush] : ""
                    }`}
                    onClick={() => placeCommand(cmd)}
                    disabled={locked}
                    aria-label={COMMAND_INFO[cmd].label}
                  >
                    {COMMAND_INFO[cmd].content}
                  </button>
                ))}
              </div>

              <div className={styles.row}>
                {hasColors && (
                  <div
                    className={styles.brushes}
                    role="group"
                    aria-label="Run the command on"
                  >
                    <button
                      className={`${styles.brush} ${
                        brush === null ? styles.brushOn : ""
                      }`}
                      onClick={() => selectBrush(null)}
                      disabled={locked}
                      aria-pressed={brush === null}
                      aria-label="Any colour"
                    />

                    {parsed.colors.map((color) => (
                      <button
                        key={color}
                        className={`${styles.brush} ${styles[color]} ${
                          brush === color ? styles.brushOn : ""
                        }`}
                        onClick={() => selectBrush(color)}
                        disabled={locked}
                        aria-pressed={brush === color}
                        aria-label={`Only on ${color}`}
                      />
                    ))}
                  </div>
                )}

                <span className={styles.spacer} />

                <button
                  className={styles.btn}
                  onClick={eraseSlot}
                  disabled={locked}
                  aria-label="Erase slot"
                >
                  <EraseIcon />
                </button>

                <button
                  className={styles.btn}
                  onClick={clearProgram}
                  disabled={locked || !hasCommands}
                  aria-label="Clear program"
                >
                  <TrashIcon />
                </button>
              </div>
            </section>

            <section
              className={`${styles.card} ${styles.panel} ${styles.execution}`}
              aria-label="Execution"
            >
              <button
                className={`${styles.btn} ${styles.go} ${styles.playButton}`}
                onClick={handlePlay}
                disabled={over || !hasCommands}
                aria-label={playLabel}
              >
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>

              <button
                className={styles.btn}
                onClick={handleStop}
                disabled={!run}
                aria-label="Stop and reset"
              >
                <StopIcon />
              </button>

              <button
                className={styles.btn}
                onClick={cycleSpeed}
                aria-label={`Speed x${speed}. Tap to change.`}
              >
                x{speed}
              </button>
            </section>
          </div>
        </div>

        {showHelp && (
          <div className={styles.overlay} onClick={() => setShowHelp(false)}>
            <div
              className={`${styles.card} ${styles.help}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.helpBar}>
                {Object.entries(HELP_TEXT).map(([code, text]) => (
                  <button
                    key={code}
                    className={`${styles.btn} ${
                      helpLanguage === code ? styles.languageOn : ""
                    }`}
                    onClick={() => {
                      setHelpLanguage(code);
                      playSound('tap');
                    }}
                    aria-pressed={helpLanguage === code}
                    lang={code}
                  >
                    {text.name}
                  </button>
                ))}

                <span className={styles.spacer} />

                <button
                  className={`${styles.btn} ${styles.go}`}
                  onClick={() => setShowHelp(false)}
                  lang={helpLanguage}
                  autoFocus
                >
                  {HELP_TEXT[helpLanguage].close}
                </button>
              </div>

              <div
                className={styles.helpText}
                lang={helpLanguage}
                dir={HELP_TEXT[helpLanguage].dir}
              >
                <h2 id="help-title">{HELP_TEXT[helpLanguage].title}</h2>

                <ol>
                  {HELP_TEXT[helpLanguage].steps.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>

                <p className={styles.credit}>{HELP_TEXT[helpLanguage].credit}</p>
              </div>

            </div>
          </div>
        )}


      {showEnd && (
        <div className={styles.overlay}>
          <div className={`${styles.card} ${styles.victory}`} role="dialog" aria-modal="true" aria-labelledby="victory-title">
            <img src={allSolved ? MOODS.victory : solved.some(Boolean) ? MOODS.celebrate : MOODS.thinking} alt="" width={128} height={128} className={styles.victoryGif} />

            <div className={styles.victoryText}>
              <h2 id="victory-title">{allSolved ? 'Victory!' : 'RoboPath finished'}</h2>
              <p>
                {allSolved
                  ? `You solved all ${levels.length} levels. You think like a programmer!`
                  : `You solved ${solved.filter(Boolean).length} of ${levels.length} levels.`}
              </p>
              <p className="rp-final"><b>{data.points}</b> / 100 points</p>
              <p className={styles.credit}>A game by N7GD (Game Dev).</p>

              <div className={styles.victoryActions}>
                <button className={`${styles.btn} ${styles.go}`} onClick={onContinue} autoFocus data-testid="rp-continue">
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </main>
    </div>
    {confirmEl}
    </>
  );
}
