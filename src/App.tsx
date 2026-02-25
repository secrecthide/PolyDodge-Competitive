import React, { useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';
import nipplejs from 'nipplejs';
import { Target, Trophy, Heart, Shield, Users, Play, Info, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [gameState, setGameState] = useState<'menu' | 'lobby' | 'playing'>('menu');
  const [isMobile, setIsMobile] = useState(false);
  const joystickRef = useRef<any>(null);
  const lookTouchId = useRef<number | null>(null);
  const lastLookTouch = useRef<{ x: number, y: number } | null>(null);

  const handleLookTouchStart = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      // If touch is on the right half of the screen and we're not already tracking a look touch
      if (touch.clientX > window.innerWidth / 2 && lookTouchId.current === null) {
        lookTouchId.current = touch.identifier;
        lastLookTouch.current = { x: touch.clientX, y: touch.clientY };
      }
    }
  };

  const handleLookTouchMove = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === lookTouchId.current && lastLookTouch.current) {
        const dx = touch.clientX - lastLookTouch.current.x;
        const dy = touch.clientY - lastLookTouch.current.y;
        
        if (gameRef.current) {
          // Scale down the delta for smoother looking
          gameRef.current.setMobileLook(dx, dy);
        }
        
        lastLookTouch.current = { x: touch.clientX, y: touch.clientY };
      }
    }
  };

  const handleLookTouchEnd = (e: React.TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === lookTouchId.current) {
        lookTouchId.current = null;
        lastLookTouch.current = null;
      }
    }
  };

  useEffect(() => {
    const checkMobile = () => {
      const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      const isSmallScreen = window.innerWidth < 1024;
      const mobile = isTouch || isSmallScreen;
      setIsMobile(mobile);
      if (gameRef.current) {
        gameRef.current.setMobile(mobile);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (gameState === 'playing' && isMobile) {
      // Initialize movement joystick
      const moveContainer = document.getElementById('joystick-move');
      if (moveContainer) {
        const manager = nipplejs.create({
          zone: moveContainer,
          mode: 'static',
          position: { left: '80px', bottom: '80px' },
          color: 'white',
          size: 100
        });

        manager.on('move', (evt, data) => {
          if (gameRef.current) {
            gameRef.current.setMobileMove(data.vector.x, data.vector.y);
          }
        });

        manager.on('end', () => {
          if (gameRef.current) {
            gameRef.current.setMobileMove(0, 0);
          }
        });

        joystickRef.current = manager;
      }
    }

    return () => {
      if (joystickRef.current) {
        joystickRef.current.destroy();
        joystickRef.current = null;
      }
    };
  }, [gameState, isMobile]);

  const [hudData, setHudData] = useState({
    score: 0,
    team: 'blue',
    holding: false,
    canPickUp: false,
    isOut: false,
    isAimingAtEnemy: false,
    winner: null as string | null,
    stamina: 100,
    chargeLevel: 0,
    isBlocking: false,
    timer: 180,
    bluePlayersLeft: 4,
    redPlayersLeft: 4,
    isLobby: false,
    lobbyTimer: 120,
    playersCount: 0,
    lobbyMode: 'casual' as 'casual' | 'ranked',
    matchState: 'playing' as 'warmup' | 'playing' | 'finished'
  });

  const [playerProfile, setPlayerProfile] = useState(() => {
    const saved = localStorage.getItem('polyDodge_profile');
    if (saved) return JSON.parse(saved);
    return {
      username: 'Player',
      level: 1,
      xp: 0,
      nextXp: 100,
      rank: 'Bronze I',
      coins: 0,
      gems: 0
    };
  });

  useEffect(() => {
    localStorage.setItem('polyDodge_profile', JSON.stringify(playerProfile));
  }, [playerProfile]);

  const [sensitivity, setSensitivity] = useState(() => {
    const saved = localStorage.getItem('polyDodge_sensitivity');
    return saved ? parseFloat(saved) : 1.0;
  });

  useEffect(() => {
    localStorage.setItem('polyDodge_sensitivity', sensitivity.toString());
  }, [sensitivity]);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCustomization, setShowCustomization] = useState(false);
  const [customizationTab, setCustomizationTab] = useState<'Skins' | 'Balls' | 'Emotes'>('Skins');
  const [selectedSkin, setSelectedSkin] = useState('Blue');
  const [selectedBall, setSelectedBall] = useState('Yellow');
  const [selectedEmote, setSelectedEmote] = useState('GG');
  const [showInGameMenu, setShowInGameMenu] = useState(false);

  // Use a ref for the HUD update callback to avoid stale closures
  const hudCallbackRef = useRef<(data: any) => void>(null);

  useEffect(() => {
    hudCallbackRef.current = (data: any) => {
      setHudData(prev => {
        const newData = { ...prev, ...data };
        
        // Handle state transitions from Game
        if (newData.isLobby === false && newData.winner === null && gameState === 'lobby') {
           setGameState('playing');
           if (!isMobile) {
             gameRef.current?.lock();
           }
        }

        // Update stats if winner is declared
        if (data.winner && !prev.winner) {
          setPlayerProfile(p => {
            const won = data.winner === prev.team;
            const xpGain = won ? 50 : 20;
            const coinGain = won ? 100 : 30;
            let newXp = p.xp + xpGain;
            let newLevel = p.level;
            let newNextXp = p.nextXp;
            
            if (newXp >= p.nextXp) {
              newXp -= p.nextXp;
              newLevel++;
              newNextXp = Math.floor(p.nextXp * 1.2);
            }
            
            return {
              ...p,
              xp: newXp,
              level: newLevel,
              nextXp: newNextXp,
              coins: p.coins + coinGain
            };
          });
        }

        return newData;
      });
    };
  }, [gameState]);

  const skins = ['Blue', 'Red', 'Emerald', 'Gold', 'Obsidian', 'Cyber', 'Ghost', 'Crimson'];
  const balls = ['Yellow', 'Neon Blue', 'Neon Red', 'Rainbow', 'Void', 'Plasma'];
  const emotes = ['Nice shot!', 'Dodge this!', 'GG', 'Oops!', 'Wait...', 'LOL', 'Unlucky'];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState === 'playing') {
        if (e.code === 'Escape' || e.code === 'KeyP') {
          setShowInGameMenu(prev => !prev);
          if (gameRef.current) {
            if (!showInGameMenu) {
              document.exitPointerLock();
            }
          }
        }
        if (hudData.isOut) {
          if (e.code === 'ArrowRight' || e.code === 'KeyD') gameRef.current?.cycleSpectator(1);
          if (e.code === 'ArrowLeft' || e.code === 'KeyA') gameRef.current?.cycleSpectator(-1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, showInGameMenu, hudData.isOut]);

  useEffect(() => {
    if (containerRef.current && !gameRef.current) {
      gameRef.current = new Game(containerRef.current, (data) => {
        if (hudCallbackRef.current) {
          hudCallbackRef.current(data);
        }
      });
    }
  }, []);

  useEffect(() => {
    if (gameRef.current) {
      gameRef.current.setSensitivity(sensitivity);
    }
  }, [sensitivity]);

  const startOnline = (mode: 'casual' | 'ranked' = 'casual') => {
    if (gameRef.current) {
      gameRef.current.connect(mode);
      setGameState('lobby');
    }
  };

  const cancelOnline = () => {
    if (gameRef.current) {
      gameRef.current.disconnect();
      setGameState('menu');
    }
  };

  const startBots = () => {
    if (gameRef.current) {
      gameRef.current.startOffline();
      if (!isMobile) {
        gameRef.current.lock();
      }
      setGameState('playing');
      setHudData(prev => ({ ...prev, winner: null }));
    }
  };

  return (
    <div className="fixed inset-0 w-screen h-screen bg-black overflow-hidden font-sans text-white select-none">
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* Crosshair */}
      {gameState === 'playing' && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className={`w-4 h-4 border-2 rounded-full flex items-center justify-center transition-all duration-200 ${
            hudData.canPickUp ? 'border-emerald-400 scale-150' : 
            hudData.isAimingAtEnemy ? 'border-red-500 scale-125' : 'border-white/50'
          }`}>
            <div className={`w-1 h-1 rounded-full ${
              hudData.canPickUp ? 'bg-emerald-400' : 
              hudData.isAimingAtEnemy ? 'bg-red-500' : 'bg-white'
            }`} />
          </div>
          {hudData.canPickUp && (
            <div className="absolute mt-16" />
          )}
        </div>
      )}

      {/* HUD */}
      <AnimatePresence>
        {gameState === 'playing' && (
          <>
            {/* Winner Overlay */}
            {hudData.winner && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center"
              >
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="text-center"
                >
                  <h2 className={`text-8xl font-black italic tracking-tighter drop-shadow-2xl ${hudData.winner === 'blue' ? 'text-blue-400' : 'text-red-400'}`}>
                    {hudData.winner.toUpperCase()} TEAM WINS!
                  </h2>
                  <p className="text-white/80 font-bold uppercase tracking-widest mt-4 text-2xl">New round starting soon...</p>
                </motion.div>
              </motion.div>
            )}

            {/* Hit Flash Overlay */}
            {hudData.isOut && (
              <div className="absolute inset-0 z-40 bg-red-600/10 pointer-events-none" />
            )}
            
            {/* Warmup Countdown */}
            {hudData.matchState === 'warmup' && (
              <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
                <motion.div 
                  key={Math.ceil(hudData.timer)}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 1.5, opacity: 0 }}
                  className="text-center"
                >
                  <h1 className="text-9xl font-black italic text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]">
                    {Math.ceil(hudData.timer)}
                  </h1>
                  <p className="text-3xl font-bold uppercase tracking-widest text-white/80 mt-4">Get Ready</p>
                </motion.div>
              </div>
            )}

            {hudData.isOut && isMobile && (
              <div 
                className="absolute inset-0 z-20 pointer-events-auto"
                onTouchStart={handleLookTouchStart}
                onTouchMove={handleLookTouchMove}
                onTouchEnd={handleLookTouchEnd}
                onTouchCancel={handleLookTouchEnd}
              />
            )}

            {hudData.isOut && (
              <div className="absolute bottom-32 left-1/2 -translate-x-1/2 z-30 text-center">
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="bg-black/60 backdrop-blur-md border border-white/10 px-8 py-4 rounded-3xl shadow-2xl"
                >
                  <div className="text-[10px] uppercase tracking-[0.3em] text-white/50 font-black mb-2">Spectating Mode</div>
                  <div className="text-lg font-black text-emerald-400 uppercase tracking-widest flex items-center gap-8">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[8px] text-white/30">{isMobile ? 'TAP LEFT' : 'PREV'}</span>
                      <button 
                        onClick={() => gameRef.current?.cycleSpectator(-1)}
                        className="bg-white/10 px-2 py-1 rounded text-xs active:bg-white/30"
                      >
                        {isMobile ? 'PREV' : 'A / LMB'}
                      </button>
                    </div>
                    <div className="h-8 w-px bg-white/10" />
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[8px] text-white/30">{isMobile ? 'TAP RIGHT' : 'NEXT'}</span>
                      <button 
                        onClick={() => gameRef.current?.cycleSpectator(1)}
                        className="bg-white/10 px-2 py-1 rounded text-xs active:bg-white/30"
                      >
                        {isMobile ? 'NEXT' : 'D / RMB'}
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 text-[9px] text-white/40 uppercase font-bold">{isMobile ? 'Swipe right side to orbit' : 'Move mouse to orbit camera'}</div>
                </motion.div>
              </div>
            )}

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`absolute inset-0 pointer-events-none p-4 md:p-6 flex flex-col justify-between ${isMobile ? 'scale-90 origin-center' : ''}`}
            >
            <div className={`flex justify-between items-start w-full ${isMobile ? 'flex-col gap-2' : ''}`}>
              {/* Left: Team Info */}
              <div className="bg-black/60 backdrop-blur-md border border-white/10 px-3 py-2 md:px-4 md:py-3 rounded-2xl flex items-center gap-2 md:gap-4 min-w-[150px] md:min-w-[200px]">
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                  <Shield className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold">Team</div>
                  <div className={`text-xl font-mono font-bold ${hudData.team === 'blue' ? 'text-blue-400' : 'text-red-400'}`}>
                    {hudData.team.toUpperCase()}
                  </div>
                </div>
                <div className="w-px h-8 bg-white/10 mx-2" />
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold">Status</div>
                  <div className="text-xl font-mono font-bold">{hudData.isOut ? 'OUT' : 'IN PLAY'}</div>
                </div>
              </div>

              {/* Center: Timer & Team Counts */}
              <div className="flex flex-col items-center gap-2 transform -translate-y-2">
                <div className="flex items-center gap-8">
                  {/* Blue Team Count */}
                  <div className="flex flex-col items-end">
                    <div className="text-[8px] font-black text-blue-400/50 uppercase tracking-widest">Blue</div>
                    <div className="flex gap-1 mt-1">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div 
                          key={i} 
                          className={`w-2.5 h-1 rounded-full transition-all duration-500 ${i < hudData.bluePlayersLeft ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]' : 'bg-white/10'}`} 
                        />
                      ))}
                    </div>
                  </div>

                  {/* Timer */}
                  <div className="bg-black/80 backdrop-blur-xl border border-white/10 px-6 py-2 rounded-2xl flex flex-col items-center min-w-[100px] shadow-2xl">
                    <div className={`text-2xl font-mono font-bold tabular-nums ${hudData.timer < 30 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                      {Math.floor(hudData.timer / 60)}:{String(hudData.timer % 60).padStart(2, '0')}
                    </div>
                  </div>

                  {/* Red Team Count */}
                  <div className="flex flex-col items-start">
                    <div className="text-[8px] font-black text-red-400/50 uppercase tracking-widest">Red</div>
                    <div className="flex gap-1 mt-1">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div 
                          key={i} 
                          className={`w-2.5 h-1 rounded-full transition-all duration-500 ${i < hudData.redPlayersLeft ? 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]' : 'bg-white/10'}`} 
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="text-[8px] font-black text-white/20 uppercase tracking-[0.4em]">Arena Match</div>
              </div>

              {/* Right: Score */}
              <div className={`bg-black/60 backdrop-blur-md border border-white/10 px-3 py-2 md:px-4 md:py-3 rounded-2xl flex items-center gap-2 md:gap-4 min-w-[150px] md:min-w-[200px] justify-end ${isMobile ? 'self-end' : ''}`}>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold">Score</div>
                  <div className="text-xl font-mono font-bold">{hudData.score}</div>
                </div>
                <div className="p-2 bg-amber-500/20 rounded-lg">
                  <Trophy className="w-5 h-5 text-amber-400" />
                </div>
              </div>
            </div>

            {/* Mobile Controls */}
            {isMobile && !hudData.isOut && (
              <>
                {/* Look Surface (Mobile only) - covers whole screen but lower z-index than buttons */}
                <div 
                  className="absolute inset-0 z-40 pointer-events-auto"
                  onTouchStart={handleLookTouchStart}
                  onTouchMove={handleLookTouchMove}
                  onTouchEnd={handleLookTouchEnd}
                  onTouchCancel={handleLookTouchEnd}
                />
                
                <div className="absolute inset-0 pointer-events-none z-50">
                  <div id="joystick-move" className="absolute bottom-0 left-0 w-1/2 h-1/2 pointer-events-auto" />
                  
                  {/* Action Buttons */}
                  <div className="absolute bottom-32 right-8 flex flex-col gap-4 pointer-events-auto items-end">
                  <button 
                    onTouchStart={() => gameRef.current?.setMobileAction('throw', true)}
                    onTouchEnd={() => gameRef.current?.setMobileAction('throw', false)}
                    className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center active:bg-white/30 active:scale-90 transition-all shadow-2xl"
                  >
                    <Target className="w-8 h-8" />
                  </button>
                  <div className="flex gap-4">
                    <button 
                      onTouchStart={() => gameRef.current?.setMobileAction('block', true)}
                      onTouchEnd={() => gameRef.current?.setMobileAction('block', false)}
                      className="w-14 h-14 rounded-full bg-blue-500/20 backdrop-blur-md border border-blue-500/30 flex items-center justify-center active:bg-blue-500/40 active:scale-90 transition-all shadow-xl"
                    >
                      <Shield className="w-6 h-6 text-blue-400" />
                    </button>
                    <button 
                      onTouchStart={() => gameRef.current?.setMobileAction('sprint', true)}
                      onTouchEnd={() => gameRef.current?.setMobileAction('sprint', false)}
                      className="w-14 h-14 rounded-full bg-amber-500/20 backdrop-blur-md border border-amber-500/30 flex items-center justify-center active:bg-amber-500/40 active:scale-90 transition-all shadow-xl"
                    >
                      <Zap className="w-6 h-6 text-amber-400" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

            {/* Bottom HUD: Stamina & Charge */}
            <div className={`flex justify-center items-end pb-6 gap-6 ${isMobile ? 'opacity-50 pointer-events-none' : ''}`}>
              {/* Stamina Bar */}
              <div className="w-64 bg-black/60 backdrop-blur-md border border-white/10 p-3 rounded-xl shadow-lg">
                <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold mb-2">
                  <span className="text-white/50">Stamina</span>
                  <span className={hudData.stamina < 20 ? 'text-red-400' : 'text-emerald-400'}>
                    {Math.round(hudData.stamina)}%
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-100 ${hudData.stamina < 20 ? 'bg-red-500' : 'bg-emerald-500'}`}
                    style={{ width: `${hudData.stamina}%` }}
                  />
                </div>
              </div>

              {/* Charge Bar (Only visible when charging/holding) */}
              <div className={`w-64 bg-black/60 backdrop-blur-md border border-white/10 p-3 rounded-xl shadow-lg transition-opacity duration-200 ${hudData.chargeLevel > 0 ? 'opacity-100' : 'opacity-0'}`}>
                <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold mb-2">
                  <span className="text-white/50">Throw Power</span>
                  <span className={hudData.chargeLevel >= 1.5 ? 'text-red-400 animate-pulse' : 'text-amber-400'}>
                    {hudData.chargeLevel >= 1.5 ? 'MAX' : `${Math.round((hudData.chargeLevel / 1.5) * 100)}%`}
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-75 ${hudData.chargeLevel >= 1.5 ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-amber-500'}`}
                    style={{ width: `${(hudData.chargeLevel / 1.5) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>

      {/* Lobby Overlay */}
      <AnimatePresence>
        {gameState === 'lobby' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4"
          >
            <div className={`text-center w-full ${isMobile ? 'max-w-xs' : 'max-w-md'} ${isMobile ? 'p-4' : 'p-8'}`}>
              <div className={`${isMobile ? 'mb-4' : 'mb-8'} relative`}>
                <div className={`${isMobile ? 'w-16 h-16' : 'w-24 h-24'} border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto`} />
                <Users className={`${isMobile ? 'w-6 h-6' : 'w-8 h-8'} text-emerald-400 absolute inset-0 m-auto`} />
              </div>
              
              <h2 className={`${isMobile ? 'text-2xl' : 'text-4xl'} font-black uppercase italic tracking-tighter mb-2`}>
                {hudData.lobbyMode === 'ranked' ? 'Ranked Match' : 'Casual Match'}
              </h2>
              <p className="text-white/50 text-[10px] md:text-sm uppercase tracking-widest mb-4 md:mb-8">
                {hudData.lobbyMode === 'ranked' ? 'Waiting for 8 real players' : 'Searching for players'}
              </p>
              
              <div className={`bg-white/5 border border-white/10 rounded-2xl ${isMobile ? 'p-4' : 'p-6'} mb-6 md:mb-8`}>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Players Found</span>
                  <span className={`font-mono font-bold ${hudData.playersCount >= 8 ? 'text-emerald-400' : 'text-white'}`}>
                    {hudData.playersCount} / 8
                  </span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div 
                    className={`h-full ${hudData.lobbyMode === 'ranked' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(hudData.playersCount / 8) * 100}%` }}
                  />
                </div>
                <div className="mt-6 flex justify-between items-center">
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                    {hudData.lobbyMode === 'ranked' && hudData.playersCount < 8 ? 'Waiting...' : 'Starting in'}
                  </span>
                  <span className="font-mono font-bold text-amber-400">
                    {hudData.lobbyMode === 'ranked' && hudData.playersCount < 8 ? '--:--' : `${Math.floor(hudData.lobbyTimer / 60)}:${String(hudData.lobbyTimer % 60).padStart(2, '0')}`}
                  </span>
                </div>
              </div>

              <button 
                onClick={cancelOnline}
                className="w-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 border border-white/10 hover:border-red-500/30 py-3 md:py-4 rounded-2xl font-bold uppercase tracking-widest transition-all text-sm"
              >
                Cancel Search
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Menu */}
      <AnimatePresence>
        {gameState === 'menu' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`absolute inset-0 z-50 flex bg-zinc-950 ${isMobile ? 'flex-col overflow-y-auto' : 'flex-row'}`}
          >
            {/* Animated Background Placeholder */}
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-900/40 via-zinc-950 to-zinc-950 pointer-events-none" />

            {/* Top Right Profile & Currency */}
            <div className={`absolute top-4 right-4 md:top-6 md:right-8 flex items-center gap-3 md:gap-6 z-20 ${isMobile ? 'scale-75 origin-top-right' : ''}`}>
              <div className="flex gap-2 md:gap-4">
                <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 md:px-4 md:py-2 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="font-mono font-bold text-amber-400 text-sm md:text-base">{playerProfile.coins}</span>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 md:px-4 md:py-2 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-400" />
                  <span className="font-mono font-bold text-purple-400 text-sm md:text-base">{playerProfile.gems}</span>
                </div>
              </div>
              <div className="w-px h-6 md:h-8 bg-white/10" />
              <div className="flex items-center gap-3 md:gap-4">
                <div className="text-right hidden sm:block">
                  <div className="font-bold text-sm md:text-base">{playerProfile.username}</div>
                  <div className="text-[8px] md:text-[10px] uppercase tracking-widest text-emerald-400 font-bold">{playerProfile.rank}</div>
                </div>
                <div className="relative w-10 h-10 md:w-12 md:h-12 bg-white/10 rounded-xl flex items-center justify-center border border-white/20">
                  <span className="font-black text-lg md:text-xl">{playerProfile.level}</span>
                  <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                    <circle cx="50" cy="50" r="48" fill="none" stroke="#34d399" strokeWidth="4" strokeDasharray={`${(playerProfile.xp / playerProfile.nextXp) * 300} 300`} />
                  </svg>
                </div>
              </div>
            </div>

            {/* Left Column: Daily Challenges - Hidden on mobile or moved to bottom */}
            {!isMobile && (
              <div className="w-80 p-8 flex flex-col justify-end z-10 border-r border-white/5 bg-black/20 backdrop-blur-sm">
                <h3 className="text-xs font-black uppercase tracking-widest text-white/50 mb-4">Daily Challenges</h3>
                <div className="space-y-3">
                  {[
                    { title: "Catch 5 Balls", progress: 0, total: 5, reward: "150 Coins" },
                    { title: "Win 3 Ranked Games", progress: 0, total: 3, reward: "50 Gems" },
                    { title: "Eliminate 10 Players", progress: 0, total: 10, reward: "300 Coins" }
                  ].map((challenge, i) => (
                    <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold text-sm">{challenge.title}</div>
                        <div className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-2 py-1 rounded">{challenge.reward}</div>
                      </div>
                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${(challenge.progress / challenge.total) * 100}%` }} />
                      </div>
                      <div className="text-[10px] text-right mt-1 text-white/40 font-mono">{challenge.progress} / {challenge.total}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Center Column: Main Menu */}
            <div className={`flex-1 flex flex-col items-center justify-center z-10 p-6 ${isMobile ? 'pt-24' : ''}`}>
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-center mb-8 md:mb-16"
              >
                <div className={`inline-block p-3 md:p-4 bg-white/5 rounded-3xl mb-4 md:mb-6 border border-white/10 shadow-2xl ${isMobile ? 'scale-75' : ''}`}>
                  <Shield className="w-12 h-12 md:w-16 md:h-16 text-emerald-400" />
                </div>
                <h1 className={`${isMobile ? 'text-5xl' : 'text-7xl'} font-black tracking-tighter mb-2 uppercase italic drop-shadow-lg`}>
                  Poly<span className="text-emerald-400">Dodge</span>
                </h1>
                <div className="flex items-center justify-center gap-2 text-white/40 text-[10px] md:text-xs tracking-[0.3em] uppercase font-bold">
                  <span className="w-4 md:w-8 h-px bg-white/20" />
                  Competitive Edition
                  <span className="w-4 md:w-8 h-px bg-white/20" />
                </div>
              </motion.div>

              <div className={`w-full ${isMobile ? 'max-w-xs' : 'max-w-sm'} space-y-3`}>
                <button 
                  onClick={() => startOnline('ranked')}
                  className={`w-full group relative overflow-hidden bg-amber-500 text-black px-6 py-4 md:px-8 md:py-5 rounded-2xl font-black ${isMobile ? 'text-lg' : 'text-xl'} flex items-center justify-between transition-transform hover:scale-[1.02] active:scale-95 shadow-[0_0_40px_rgba(245,158,11,0.3)]`}
                >
                  <div className="flex items-center gap-3 md:gap-4">
                    <Trophy className="w-5 h-5 md:w-6 md:h-6" />
                    RANKED MATCH
                  </div>
                  <span className="text-xs md:text-sm font-bold opacity-70">4v4</span>
                  <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                </button>

                <button 
                  onClick={() => startOnline('casual')}
                  className={`w-full bg-white/10 hover:bg-white/15 border border-white/10 px-6 py-3 md:px-8 md:py-4 rounded-2xl font-bold ${isMobile ? 'text-base' : 'text-lg'} flex items-center gap-3 md:gap-4 transition-all active:scale-95`}
                >
                  <Users className="w-4 h-4 md:w-5 md:h-5 text-emerald-400" />
                  Casual Match
                </button>

                <button 
                  onClick={startBots}
                  className={`w-full bg-white/5 hover:bg-white/10 border border-white/10 px-6 py-3 md:px-8 md:py-4 rounded-2xl font-bold ${isMobile ? 'text-base' : 'text-lg'} flex items-center gap-3 md:gap-4 transition-all active:scale-95`}
                >
                  <Play className="w-4 h-4 md:w-5 md:h-5 text-purple-400" />
                  Practice vs Bots
                </button>
                
                <div className="grid grid-cols-2 gap-3 pt-4 border-t border-white/10">
                  <button 
                    onClick={() => setShowCustomization(true)}
                    className="bg-white/5 hover:bg-white/10 border border-white/10 py-3 rounded-xl font-bold text-xs md:text-sm text-white/70 transition-colors"
                  >
                    Customization
                  </button>
                  <button 
                    onClick={() => setShowSettings(true)}
                    className="bg-white/5 hover:bg-white/10 border border-white/10 py-3 rounded-xl font-bold text-xs md:text-sm text-white/70 transition-colors"
                  >
                    Settings
                  </button>
                </div>
              </div>

              {isMobile && (
                <div className="mt-12 w-full max-w-xs">
                   <h3 className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-4 text-center">Daily Challenges</h3>
                   <div className="flex gap-2 overflow-x-auto pb-4 custom-scrollbar">
                      {[
                        { title: "Catch 5", progress: 0, total: 5 },
                        { title: "Win 3", progress: 0, total: 3 },
                        { title: "Elim 10", progress: 0, total: 10 }
                      ].map((challenge, i) => (
                        <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-3 min-w-[120px]">
                          <div className="font-bold text-[10px] mb-2 truncate">{challenge.title}</div>
                          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: `${(challenge.progress / challenge.total) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                   </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Customization Modal */}
      <AnimatePresence>
        {showCustomization && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
          >
            <div className={`w-full bg-zinc-900 border border-white/10 rounded-3xl ${isMobile ? 'p-4' : 'p-8'} ${isMobile ? 'max-w-xs' : 'max-w-2xl'}`}>
              <h2 className={`${isMobile ? 'text-xl' : 'text-3xl'} font-black mb-4 md:mb-8 uppercase italic`}>Customization</h2>
              
              <div className={`grid grid-cols-3 gap-2 md:gap-4 mb-4 md:mb-8`}>
                {(['Skins', 'Balls', 'Emotes'] as const).map((tab) => (
                  <button 
                    key={tab} 
                    onClick={() => setCustomizationTab(tab)}
                    className={`${isMobile ? 'p-2' : 'p-4'} rounded-2xl text-center transition-all border ${
                      customizationTab === tab ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className={`text-[10px] md:text-xs font-black uppercase tracking-widest mb-1 ${
                      customizationTab === tab ? 'text-emerald-400' : 'text-white/50'
                    }`}>{tab}</div>
                  </button>
                ))}
              </div>

              <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-2 md:gap-3 ${isMobile ? 'max-h-[40vh]' : 'max-h-[300px]'} overflow-y-auto pr-2 custom-scrollbar`}>
                {customizationTab === 'Skins' && skins.map(skin => (
                  <button 
                    key={skin}
                    onClick={() => {
                      setSelectedSkin(skin);
                      gameRef.current?.applyCustomization('skin', skin);
                    }}
                    className={`${isMobile ? 'p-3' : 'p-4'} rounded-2xl border flex items-center gap-3 md:gap-4 transition-all ${
                      selectedSkin === skin ? 'bg-emerald-500/20 border-emerald-500/50' : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className={`w-6 h-6 md:w-8 md:h-8 rounded-lg ${
                      skin === 'Blue' ? 'bg-blue-500' :
                      skin === 'Red' ? 'bg-red-500' :
                      skin === 'Emerald' ? 'bg-emerald-500' :
                      skin === 'Gold' ? 'bg-amber-500' :
                      skin === 'Obsidian' ? 'bg-zinc-800' :
                      skin === 'Cyber' ? 'bg-cyan-400' :
                      skin === 'Ghost' ? 'bg-white/20 backdrop-blur-sm' : 'bg-red-900'
                    }`} />
                    <div className="font-bold text-xs md:text-sm">{skin}</div>
                    {selectedSkin === skin && <div className="ml-auto text-[8px] md:text-[10px] font-black text-emerald-400">EQUIPPED</div>}
                  </button>
                ))}

                {customizationTab === 'Balls' && balls.map(ball => (
                  <button 
                    key={ball}
                    onClick={() => {
                      setSelectedBall(ball);
                      gameRef.current?.applyCustomization('ball', ball);
                    }}
                    className={`${isMobile ? 'p-3' : 'p-4'} rounded-2xl border flex items-center gap-3 md:gap-4 transition-all ${
                      selectedBall === ball ? 'bg-emerald-500/20 border-emerald-500/50' : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className={`w-6 h-6 md:w-8 md:h-8 rounded-full border-2 ${
                      ball === 'Yellow' ? 'bg-yellow-400 border-yellow-200' :
                      ball === 'Neon Blue' ? 'bg-cyan-400 border-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.5)]' :
                      ball === 'Neon Red' ? 'bg-red-400 border-red-200 shadow-[0_0_10px_rgba(248,113,113,0.5)]' :
                      ball === 'Void' ? 'bg-black border-purple-900 shadow-[0_0_15px_rgba(147,51,234,0.5)]' :
                      ball === 'Plasma' ? 'bg-pink-500 border-pink-200 shadow-[0_0_15px_rgba(236,72,153,0.5)]' :
                      'bg-gradient-to-tr from-red-500 via-green-500 to-blue-500 border-white'
                    }`} />
                    <div className="font-bold text-xs md:text-sm">{ball}</div>
                    {selectedBall === ball && <div className="ml-auto text-[8px] md:text-[10px] font-black text-emerald-400">EQUIPPED</div>}
                  </button>
                ))}

                {customizationTab === 'Emotes' && emotes.map(emote => (
                  <button 
                    key={emote}
                    onClick={() => setSelectedEmote(emote)}
                    className={`${isMobile ? 'p-3' : 'p-4'} rounded-2xl border flex items-center gap-3 md:gap-4 transition-all ${
                      selectedEmote === emote ? 'bg-emerald-500/20 border-emerald-500/50' : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="w-6 h-6 md:w-8 md:h-8 bg-white/10 rounded-lg flex items-center justify-center text-base md:text-lg">💬</div>
                    <div className="font-bold text-xs md:text-sm">{emote}</div>
                    {selectedEmote === emote && <div className="ml-auto text-[8px] md:text-[10px] font-black text-emerald-400">EQUIPPED</div>}
                  </button>
                ))}
              </div>

              <button 
                onClick={() => setShowCustomization(false)}
                className="w-full mt-6 md:mt-10 bg-emerald-500 text-black py-3 md:py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-emerald-400 transition-colors text-sm"
              >
                Back to Menu
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* In-Game Menu */}
      <AnimatePresence>
        {showInGameMenu && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
          >
            <div className={`w-full bg-zinc-900 border border-white/10 rounded-3xl ${isMobile ? 'p-6' : 'p-8'} ${isMobile ? 'max-w-xs' : 'max-w-sm'} shadow-2xl`}>
              <h2 className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-black mb-6 md:mb-8 uppercase italic text-center`}>Paused</h2>
              
              <div className="space-y-3">
                <button 
                  onClick={() => setShowInGameMenu(false)}
                  className="w-full bg-emerald-500 text-black py-3 md:py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-emerald-400 transition-colors text-sm"
                >
                  Resume Game
                </button>
                
                <button 
                  onClick={() => {
                    setShowInGameMenu(false);
                    setShowSettings(true);
                  }}
                  className="w-full bg-white/10 text-white py-3 md:py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-white/20 transition-colors text-sm"
                >
                  Settings
                </button>

                <div className="pt-4 border-t border-white/10">
                  <button 
                    onClick={() => window.location.reload()}
                    className="w-full bg-red-500/20 text-red-400 border border-red-500/30 py-3 md:py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-red-500/40 transition-colors text-sm"
                  >
                    Leave Match
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[110] flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
          >
            <div className={`w-full bg-zinc-900 border border-white/10 rounded-3xl ${isMobile ? 'p-6' : 'p-8'} ${isMobile ? 'max-w-xs' : 'max-w-md'}`}>
              <h2 className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-black mb-6 md:mb-8 uppercase italic`}>Settings</h2>
              
              <div className="space-y-6 md:space-y-8">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <label className="font-bold uppercase text-[10px] text-emerald-400 tracking-widest">Sensitivity</label>
                    <span className="font-mono text-white/60 text-xs">{sensitivity.toFixed(1)}</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="3.0" 
                    step="0.1" 
                    value={sensitivity}
                    onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>

                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between p-3 md:p-4 bg-white/5 rounded-2xl">
                    <div className="text-xs md:text-sm font-bold opacity-70">Mobile Controls</div>
                    <button 
                      onClick={() => {
                        const newVal = !isMobile;
                        setIsMobile(newVal);
                        gameRef.current?.setMobile(newVal);
                      }}
                      className={`px-3 py-1.5 md:px-4 md:py-2 rounded-full text-[10px] font-black transition-all ${isMobile ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white'}`}
                    >
                      {isMobile ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between p-3 md:p-4 bg-white/5 rounded-2xl">
                    <div className="text-xs md:text-sm font-bold opacity-70">Quality</div>
                    <div className="text-[10px] font-black bg-emerald-500 text-black px-3 py-1 rounded-full">HIGH</div>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowSettings(false)}
                className="w-full mt-8 md:mt-10 bg-emerald-500 text-black py-3 md:py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-emerald-400 transition-colors text-sm"
              >
                Back
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showInstructions && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
          >
            <div className={`w-full bg-zinc-900 border border-white/10 rounded-3xl ${isMobile ? 'p-6' : 'p-8'} ${isMobile ? 'max-w-xs' : 'max-w-lg'}`}>
              <h2 className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-black mb-4 md:mb-6 uppercase italic`}>How to play</h2>
              
              <div className="space-y-4 md:space-y-6 text-left">
                <div className="flex gap-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-white/5 rounded-xl flex items-center justify-center shrink-0 font-mono font-bold text-sm md:text-base">{isMobile ? 'L' : 'WASD'}</div>
                  <div>
                    <div className="font-bold uppercase text-[10px] text-emerald-400 mb-1">Movement</div>
                    <p className="text-white/60 text-xs md:text-sm">{isMobile ? 'Use the left joystick to move around the arena.' : 'Use WASD or Arrow keys to move around the arena.'} Dodge incoming balls!</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-white/5 rounded-xl flex items-center justify-center shrink-0 font-mono font-bold text-sm md:text-base">{isMobile ? 'R' : 'LMB'}</div>
                  <div>
                    <div className="font-bold uppercase text-[10px] text-emerald-400 mb-1">Action</div>
                    <p className="text-white/60 text-xs md:text-sm">{isMobile ? 'Use the right joystick to look. Tap the target button to grab or throw balls.' : 'Click to grab a ball when close. Click again to throw it in the direction you\'re looking.'}</p>
                  </div>
                </div>

                {!isMobile && (
                  <div className="flex gap-4">
                    <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center shrink-0 font-mono font-bold">ESC</div>
                    <div>
                      <div className="font-bold uppercase text-xs text-emerald-400 mb-1">Unlock</div>
                      <p className="text-white/60 text-sm">Press Escape to unlock your mouse cursor.</p>
                    </div>
                  </div>
                )}
              </div>

              <button 
                onClick={() => setShowInstructions(false)}
                className="w-full mt-8 md:mt-10 bg-emerald-500 text-white py-3 md:py-4 rounded-2xl font-bold uppercase tracking-widest hover:bg-emerald-400 transition-colors text-sm"
              >
                Got it
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
