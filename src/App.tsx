import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface DebrisItem {
  id: string;
  name: string;
  type: 'debris' | 'asteroid';
  mass: number;
  speed: number;
  spin: number;
  range: number;
  confidence: number;
  score: number;
  status: 'RECOMMENDED' | 'ABORT_RISK' | 'STANDBY' | 'VIABLE' | 'SPIN_HAZARD';
  color: number;
  note: string;
}

interface ActivityLog {
  id: string;
  time: string;
  tag: string;
  text: string;
  type: 'normal' | 'warn' | 'success' | 'alert';
}

const DEBRIS_DATABASE: DebrisItem[] = [
  {
    id: "DEBRIS-ALPHA",
    name: "Defunct Weather Satellite",
    type: "debris",
    mass: 1420,
    speed: 0.45,
    spin: 3.5,
    range: 16.0,
    confidence: 97.4,
    score: 94.2,
    status: "RECOMMENDED",
    color: 0x22d3ee,
    note: "Optimal target: Low spin (3.5°/s), clean planar orbit, within safety envelope."
  },
  {
    id: "DEBRIS-BETA",
    name: "Upper Stage Rocket Body",
    type: "debris",
    mass: 8200,
    speed: 2.40,
    spin: 4.8,
    range: 19.5,
    confidence: 94.1,
    score: 42.0,
    status: "ABORT_RISK",
    color: 0xf59e0b,
    note: "High approach speed (2.4 m/s) trips Gate 2 overspeed lockout."
  },
  {
    id: "ASTEROID-EROS-9",
    name: "Carbonaceous Chondrite Asteroid",
    type: "asteroid",
    mass: 3800,
    speed: 0.62,
    spin: 2.8,
    range: 17.5,
    confidence: 95.2,
    score: 91.0,
    status: "RECOMMENDED",
    color: 0xd97706,
    note: "Carbon chondrite body. Tumble rate well within limits, safe for Kevlar net deployment."
  },
  {
    id: "DEBRIS-GAMMA",
    name: "Fragmentation Shard",
    type: "debris",
    mass: 42,
    speed: 0.55,
    spin: 4.2,
    range: 28.0,
    confidence: 86.5,
    score: 51.5,
    status: "STANDBY",
    color: 0x94a3b8,
    note: "Standoff range (28m) exceeds 25m net envelope limit."
  },
  {
    id: "ASTEROID-LEO-12",
    name: "Iron Micrometeorite Fragment",
    type: "asteroid",
    mass: 910,
    speed: 0.85,
    spin: 5.2,
    range: 14.0,
    confidence: 93.6,
    score: 84.5,
    status: "VIABLE",
    color: 0xe2e8f0,
    note: "Dense metallic body. Nominal distance for capture."
  },
  {
    id: "DEBRIS-DELTA",
    name: "Solar Array Wing",
    type: "debris",
    mass: 340,
    speed: 0.38,
    spin: 2.1,
    range: 22.0,
    confidence: 95.8,
    score: 88.0,
    status: "VIABLE",
    color: 0x68f5b8,
    note: "Stable candidate with very low spin rate."
  },
  {
    id: "ASTEROID-PHOENIX",
    name: "Micro-Impact Shard Asteroid",
    type: "asteroid",
    mass: 520,
    speed: 0.32,
    spin: 18.2,
    range: 13.5,
    confidence: 96.0,
    score: 22.0,
    status: "SPIN_HAZARD",
    color: 0xff7b72,
    note: "Violent tumble (18.2°/s) trips Gate 3. Requires detumble stabilization before capture!"
  }
];

export default function App() {
  const [currentTarget, setCurrentTarget] = useState<DebrisItem>(DEBRIS_DATABASE[0]);
  const [filter, setFilter] = useState<'all' | 'debris' | 'asteroid'>('all');
  const [activeScenario, setActiveScenario] = useState<'nominal' | 'delta-v-abort' | 'tumble-lockout'>('nominal');
  const [camMode, setCamMode] = useState<'tactical' | 'chaser' | 'target'>('tactical');
  
  // Real-time flight parameters
  const [speed, setSpeed] = useState<number>(DEBRIS_DATABASE[0].speed);
  const [spin, setSpin] = useState<number>(DEBRIS_DATABASE[0].spin);
  const [range, setRange] = useState<number>(DEBRIS_DATABASE[0].range);
  const [confidence, setConfidence] = useState<number>(DEBRIS_DATABASE[0].confidence);

  // Simulation states
  const [simRunning, setSimRunning] = useState<boolean>(true);
  const [isStabilizingAttitude, setIsStabilizingAttitude] = useState<boolean>(false);
  const [attitudeError, setAttitudeError] = useState<number>(0.0);
  const [isDetumbling, setIsDetumbling] = useState<boolean>(false);
  
  // Mission progression
  const [phase, setPhase] = useState<string>('TARGET_LOCKED');
  const [neutralizedSet, setNeutralizedSet] = useState<Set<string>>(new Set());
  const [neutralizedCount, setNeutralizedCount] = useState<number>(0);
  const [sectorSafetyPct, setSectorSafetyPct] = useState<number>(98.2);
  const [captureStep, setCaptureStep] = useState<'idle' | 'approaching' | 'firing_net' | 'secured' | 'deorbiting' | 'destroyed'>('idle');

  // Logs
  const [logs, setLogs] = useState<ActivityLog[]>([
    {
      id: 'log-0',
      time: 'T+ 00:04:12',
      tag: 'SYSTEM',
      text: 'Orbital Telemetry Deck initialized. DEBRIS-ALPHA locked.',
      type: 'normal'
    }
  ]);

  const metSecondsRef = useRef<number>(252.8);
  const threeContainerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Three.js References
  const threeState = useRef<{
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    renderer: THREE.WebGLRenderer | null;
    controls: OrbitControls | null;
    earthMesh: THREE.Mesh | null;
    collectorCraft: THREE.Group | null;
    netMesh: THREE.Mesh | null;
    tetherLine: THREE.Line | null;
    aimRayLine: THREE.Line | null;
    detumbleBeamMesh: THREE.Mesh | null;
    detumbleRingsMesh: THREE.Mesh | null;
    debrisObjects: Map<string, THREE.Group>;
    rcsPlumes: THREE.Mesh[];
    chaserTargetQuat: THREE.Quaternion;
    burstParticles: THREE.Points | null;
    reqId: number | null;
  }>({
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    earthMesh: null,
    collectorCraft: null,
    netMesh: null,
    tetherLine: null,
    aimRayLine: null,
    detumbleBeamMesh: null,
    detumbleRingsMesh: null,
    debrisObjects: new Map(),
    rcsPlumes: [],
    chaserTargetQuat: new THREE.Quaternion(),
    burstParticles: null,
    reqId: null,
  });

  // State refs for animation loop
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const spinRef = useRef(spin);
  spinRef.current = spin;
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const targetRef = useRef(currentTarget);
  targetRef.current = currentTarget;
  const neutralizedSetRef = useRef(neutralizedSet);
  neutralizedSetRef.current = neutralizedSet;
  const camModeRef = useRef(camMode);
  camModeRef.current = camMode;
  const simRunningRef = useRef(simRunning);
  simRunningRef.current = simRunning;
  const isStabilizingAttitudeRef = useRef(isStabilizingAttitude);
  isStabilizingAttitudeRef.current = isStabilizingAttitude;
  const isDetumblingRef = useRef(isDetumbling);
  isDetumblingRef.current = isDetumbling;
  const captureStepRef = useRef(captureStep);
  captureStepRef.current = captureStep;

  // Add Log Helper
  const addLog = useCallback((tag: string, text: string, type: ActivityLog['type'] = 'normal') => {
    const s = Math.floor(metSecondsRef.current % 60);
    const m = Math.floor((metSecondsRef.current / 60) % 60);
    const timeStr = `T+ 00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    setLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-${Math.random()}`,
        time: timeStr,
        tag,
        text,
        type
      }
    ]);
  }, []);

  // Update target selection
  const selectTarget = useCallback((targetItem: DebrisItem) => {
    setCurrentTarget(targetItem);
    setSpeed(targetItem.speed);
    setSpin(targetItem.spin);
    setRange(targetItem.range);
    setConfidence(targetItem.confidence);
    setCaptureStep('idle');
    setPhase('TARGET_LOCKED');

    // Slew craft toward target in Three.js
    const state = threeState.current;
    if (state.collectorCraft && state.debrisObjects.has(targetItem.id)) {
      const activeObj = state.debrisObjects.get(targetItem.id)!;
      const targetDir = new THREE.Vector3()
        .subVectors(activeObj.position, state.collectorCraft.position)
        .normalize();
      state.chaserTargetQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), targetDir);
    }

    if (state.netMesh) state.netMesh.visible = false;
    if (state.tetherLine) state.tetherLine.visible = false;

    addLog('ACQUIRE', `Target lock shifted to ${targetItem.id} (${targetItem.name}). Range: ${targetItem.range}m.`, 'normal');
  }, [addLog]);

  // Gate checks
  const passRange = range <= 25.0;
  const passSpeed = speed <= 1.20;
  const passSpin = spin <= 6.0;
  const passConf = confidence >= 90.0;
  const allNominal = passRange && passSpeed && passSpin && passConf;
  const isCurrentNeutralized = neutralizedSet.has(currentTarget.id);

  // Spacecraft Attitude Stabilization Trigger
  const handleStabilizeACS = useCallback(() => {
    setIsStabilizingAttitude(true);
    const state = threeState.current;
    state.rcsPlumes.forEach(p => {
      (p.material as THREE.MeshBasicMaterial).opacity = 1.0;
      p.scale.set(1.4, 2.0, 1.4);
    });
    addLog('ACS_DAMP', 'Opposing RCS pulses fired. Damping angular velocity to 0.00°/s. Boresight locked.', 'success');

    setTimeout(() => {
      setIsStabilizingAttitude(false);
      setAttitudeError(0.0);
      state.rcsPlumes.forEach(p => {
        (p.material as THREE.MeshBasicMaterial).opacity = 0.0;
      });
      if (state.collectorCraft) {
        state.collectorCraft.quaternion.copy(state.chaserTargetQuat);
      }
    }, 1200);
  }, [addLog]);

  // Target Despin Routine
  const handleDetumbleTarget = useCallback((targetFinalSpin = 0.2) => {
    if (isDetumbling) return;
    setIsDetumbling(true);
    addLog(
      'DESPIN',
      `Eddy-current damping beam active on ${currentTarget.id}. Braking tumble rate from ${spin.toFixed(1)}°/s down to ${targetFinalSpin.toFixed(1)}°/s.`,
      'normal'
    );

    const state = threeState.current;
    if (state.detumbleBeamMesh) state.detumbleBeamMesh.visible = true;
    if (state.detumbleRingsMesh) state.detumbleRingsMesh.visible = true;

    const startSpin = spin;
    const startTime = performance.now();
    const duration = 1600;

    const animateSpin = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1.0, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);
      const cur = +(startSpin + (targetFinalSpin - startSpin) * ease).toFixed(1);
      setSpin(cur);

      if (progress < 1.0) {
        requestAnimationFrame(animateSpin);
      } else {
        setIsDetumbling(false);
        setSpin(targetFinalSpin);
        if (state.detumbleBeamMesh) state.detumbleBeamMesh.visible = false;
        if (state.detumbleRingsMesh) state.detumbleRingsMesh.visible = false;
        addLog(
          'DESPIN_GO',
          `Target ${currentTarget.id} successfully stabilized at ${targetFinalSpin.toFixed(1)}°/s. Gate 3 cleared PASS.`,
          'success'
        );
      }
    };
    requestAnimationFrame(animateSpin);
  }, [currentTarget.id, isDetumbling, spin, addLog]);

  // Execute Net Capture Workflow
  const handleExecuteCapture = useCallback(() => {
    if (isCurrentNeutralized || captureStep !== 'idle') return;
    if (!allNominal) {
      addLog('FAIL', 'INTERLOCK TRIP: Net firing blocked by safety gates.', 'alert');
      return;
    }

    setCaptureStep('approaching');
    setPhase('TERMINAL_APPROACH');
    addLog('CHASER_THRUST', 'Main thrusters active. Closing distance along boresight vector.', 'normal');

    setTimeout(() => {
      setCaptureStep('firing_net');
      setPhase('NET_DEPLOYMENT');
      const state = threeState.current;
      if (state.netMesh && state.collectorCraft) {
        state.netMesh.visible = true;
        state.netMesh.position.copy(state.collectorCraft.position).add(
          new THREE.Vector3(0, 0, 1.85).applyQuaternion(state.collectorCraft.quaternion)
        );
      }
      if (state.tetherLine) state.tetherLine.visible = true;
      addLog('NET_PYRO', `Mortar fired. Kevlar net expanding toward ${currentTarget.id}.`, 'warn');

      setTimeout(() => {
        setCaptureStep('secured');
        setPhase('DRAWSTRINGS_LOCKED');
        addLog('CAPTURE', `TARGET SECURED. Drawstrings engaged around ${currentTarget.id}.`, 'success');

        setTimeout(() => {
          setCaptureStep('deorbiting');
          setPhase('DEORBIT_RETROBURN');
          addLog('RETROBURN', 'DE-ORBIT BURN: Tether drag decelerating target into thermosphere.', 'warn');

          setTimeout(() => {
            setCaptureStep('destroyed');
            setPhase('TARGET_NEUTRALIZED');
            setNeutralizedSet((prev) => new Set(prev).add(currentTarget.id));
            setNeutralizedCount((prev) => prev + 1);
            setSectorSafetyPct((prev) => Math.min(99.9, +(prev + 0.3).toFixed(1)));

            const state = threeState.current;
            if (state.debrisObjects.has(currentTarget.id)) {
              state.debrisObjects.get(currentTarget.id)!.visible = false;
            }
            if (state.netMesh) state.netMesh.visible = false;
            if (state.tetherLine) state.tetherLine.visible = false;

            addLog(
              'DESTRUCTION',
              `TARGET DISINTEGRATED // ${currentTarget.id} incinerated in upper mesosphere (+1 Cleared).`,
              'success'
            );
          }, 2400);
        }, 1300);
      }, 1300);
    }, 1100);
  }, [allNominal, captureStep, currentTarget.id, isCurrentNeutralized, addLog]);

  // Acquire next target
  const handleAcquireNext = useCallback(() => {
    const remaining = DEBRIS_DATABASE.filter(t => !neutralizedSet.has(t.id) && t.id !== currentTarget.id);
    let next = remaining[0];
    if (!next) {
      const curIdx = DEBRIS_DATABASE.findIndex(t => t.id === currentTarget.id);
      next = DEBRIS_DATABASE[(curIdx + 1) % DEBRIS_DATABASE.length];
    }
    selectTarget(next);
  }, [currentTarget.id, neutralizedSet, selectTarget]);

  // Presets
  const handleApplyPreset = (preset: 'nominal' | 'high-vel' | 'spin-lockout' | 'stabilize-all') => {
    if (preset === 'nominal') {
      setSpeed(0.45);
      setSpin(3.5);
      setRange(16.0);
      addLog('PRESET', 'Nominal net deployment envelope parameters applied.', 'normal');
    } else if (preset === 'high-vel') {
      setSpeed(2.40);
      setSpin(4.8);
      setRange(19.5);
      addLog('PRESET', 'Velocity exceeded condition injected (Gate 2 tripped).', 'warn');
    } else if (preset === 'spin-lockout') {
      setSpeed(0.40);
      setSpin(18.5);
      setRange(14.0);
      addLog('PRESET', 'High tumble rate lockout injected (Gate 3 tripped).', 'warn');
    } else if (preset === 'stabilize-all') {
      setSpeed(0.45);
      setRange(16.0);
      handleStabilizeACS();
      handleDetumbleTarget(0.2);
    }
  };

  // Scenario quick presets
  const handleSelectScenario = (sc: 'nominal' | 'delta-v-abort' | 'tumble-lockout') => {
    setActiveScenario(sc);
    if (sc === 'nominal') {
      selectTarget(DEBRIS_DATABASE[0]);
    } else if (sc === 'delta-v-abort') {
      selectTarget(DEBRIS_DATABASE[1]);
    } else if (sc === 'tumble-lockout') {
      selectTarget(DEBRIS_DATABASE[6]);
    }
  };

  // Emergency Abort
  const handleEmergencyAbort = () => {
    setRange(36.0);
    setCaptureStep('idle');
    setPhase('ABORT_HOLD');
    const state = threeState.current;
    if (state.netMesh) state.netMesh.visible = false;
    if (state.tetherLine) state.tetherLine.visible = false;
    addLog('ABORT', 'Emergency retrograde burn executed. Safe 36m standoff assumed.', 'alert');
  };

  // Simulation Reset
  const handleResetSimulation = () => {
    setNeutralizedSet(new Set());
    setNeutralizedCount(0);
    setSectorSafetyPct(98.2);
    setCaptureStep('idle');
    setPhase('TARGET_LOCKED');
    const state = threeState.current;
    state.debrisObjects.forEach((obj) => {
      obj.visible = true;
    });
    if (state.netMesh) state.netMesh.visible = false;
    if (state.tetherLine) state.tetherLine.visible = false;
    selectTarget(DEBRIS_DATABASE[0]);
    addLog('RESET', 'Simulation reset to DEBRIS-ALPHA nominal profile.', 'normal');
  };

  // Initialize Three.js scene
  useEffect(() => {
    const container = threeContainerRef.current;
    if (!container) return;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 450;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e18);
    scene.fog = new THREE.FogExp2(0x0a0e18, 0.0018);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(28, 18, 42);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 4, 10);

    // Lights
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(70, 50, 60);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x18243b, 1.2));
    const rim = new THREE.DirectionalLight(0x22d3ee, 0.8);
    rim.position.set(-50, -25, -45);
    scene.add(rim);

    // Starfield
    const starGeo = new THREE.BufferGeometry();
    const starCount = 1000;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
      starPos[i] = (Math.random() - 0.5) * 800;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8aebff, size: 1.2, transparent: true, opacity: 0.6 })));

    // Earth
    const earthGeo = new THREE.SphereGeometry(55, 36, 36);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0c1529';
      ctx.fillRect(0, 0, 512, 256);
      ctx.fillStyle = '#16284d';
      for (let i = 0; i < 30; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * 512, Math.random() * 256, 20 + Math.random() * 30, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const earthMat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(canvas), roughness: 0.8 });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    earthMesh.position.set(0, -74, 0);
    scene.add(earthMesh);

    // Chaser Spacecraft
    const collectorCraft = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.4, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x181d2a, metalness: 0.8, roughness: 0.2 })
    );
    collectorCraft.add(body);

    const foil = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.5, 1.8),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.3 })
    );
    foil.position.y = 0.9;
    collectorCraft.add(foil);

    const wingGeo = new THREE.BoxGeometry(4.4, 0.05, 1.2);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x004e5a, metalness: 0.6, roughness: 0.1 });
    const leftW = new THREE.Mesh(wingGeo, wingMat);
    leftW.position.set(-3.4, 0, 0);
    const rightW = new THREE.Mesh(wingGeo, wingMat);
    rightW.position.set(3.4, 0, 0);
    collectorCraft.add(leftW, rightW);

    const mortar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.5, 1.0, 16),
      new THREE.MeshStandardMaterial({ color: 0x22d3ee, metalness: 0.9 })
    );
    mortar.rotation.x = Math.PI / 2;
    mortar.position.set(0, 0, 1.85);
    collectorCraft.add(mortar);

    // RCS Thruster Plumes
    const rcsPlumes: THREE.Mesh[] = [];
    const offsets = [
      { x: -1.3, y: 0.4, z: 1.4, dir: new THREE.Vector3(-1, 0, 0) },
      { x: 1.3, y: 0.4, z: 1.4, dir: new THREE.Vector3(1, 0, 0) },
      { x: -1.3, y: -0.4, z: -1.4, dir: new THREE.Vector3(-1, 0, 0) },
      { x: 1.3, y: -0.4, z: -1.4, dir: new THREE.Vector3(1, 0, 0) }
    ];
    offsets.forEach(cfg => {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 0.8, 8),
        new THREE.MeshBasicMaterial({ color: 0x8aebff, transparent: true, opacity: 0.0 })
      );
      cone.position.set(cfg.x, cfg.y, cfg.z);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cfg.dir);
      collectorCraft.add(cone);
      rcsPlumes.push(cone);
    });

    collectorCraft.position.set(0, 4, 0);
    scene.add(collectorCraft);

    // Targets
    const debrisObjects = new Map<string, THREE.Group>();
    DEBRIS_DATABASE.forEach((item, idx) => {
      const group = new THREE.Group();
      const geom = item.type === 'asteroid'
        ? new THREE.DodecahedronGeometry(1.6, 1)
        : new THREE.BoxGeometry(1.6, 1.6, 1.6);
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.6, metalness: 0.4 })
      );
      group.add(mesh);

      const bracket = new THREE.Mesh(
        new THREE.BoxGeometry(3.6, 3.6, 3.6),
        new THREE.MeshBasicMaterial({ color: item.color, wireframe: true, transparent: true, opacity: 0.35 })
      );
      group.add(bracket);

      const angle = (idx / DEBRIS_DATABASE.length) * Math.PI * 1.6 - 0.7;
      const dist = item.range;
      const xPos = Math.sin(angle) * (dist * 0.7);
      const yPos = 4 + (idx % 2 === 0 ? 1 : -1) * (2 + idx * 0.5);
      const zPos = Math.cos(angle) * dist;

      group.position.set(xPos, yPos, zPos);
      group.userData = { id: item.id, data: item, coreMesh: mesh };
      scene.add(group);
      debrisObjects.set(item.id, group);
    });

    // Aim Laser Line
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 16]), 3));
    const aimRayLine = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85 })
    );
    scene.add(aimRayLine);

    // Detumble Eddy-Current Beam
    const beamGeo = new THREE.CylinderGeometry(0.35, 1.2, 16, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x68f5b8,
      transparent: true,
      opacity: 0.0,
      wireframe: true,
      side: THREE.DoubleSide
    });
    const detumbleBeamMesh = new THREE.Mesh(beamGeo, beamMat);
    detumbleBeamMesh.visible = false;
    scene.add(detumbleBeamMesh);

    // Detumble Torus Counter-Rotation Rings
    const ringGeo = new THREE.TorusGeometry(2.2, 0.08, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.0 });
    const detumbleRingsMesh = new THREE.Mesh(ringGeo, ringMat);
    detumbleRingsMesh.visible = false;
    scene.add(detumbleRingsMesh);

    // Net and Tether
    const netGeo = new THREE.IcosahedronGeometry(2.8, 2);
    const netMesh = new THREE.Mesh(
      netGeo,
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.85 })
    );
    netMesh.visible = false;
    scene.add(netMesh);

    const tetherGeo = new THREE.BufferGeometry();
    tetherGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0]), 3));
    const tetherLine = new THREE.Line(
      tetherGeo,
      new THREE.LineBasicMaterial({ color: 0x46d89d, transparent: true, opacity: 0.85 })
    );
    tetherLine.visible = false;
    scene.add(tetherLine);

    // Setup state
    threeState.current = {
      scene,
      camera,
      renderer,
      controls,
      earthMesh,
      collectorCraft,
      netMesh,
      tetherLine,
      aimRayLine,
      detumbleBeamMesh,
      detumbleRingsMesh,
      debrisObjects,
      rcsPlumes,
      chaserTargetQuat: new THREE.Quaternion(),
      burstParticles: null,
      reqId: null
    };

    // Orient initial chaser forward
    const initialActive = debrisObjects.get(DEBRIS_DATABASE[0].id);
    if (initialActive) {
      const initDir = new THREE.Vector3().subVectors(initialActive.position, collectorCraft.position).normalize();
      threeState.current.chaserTargetQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), initDir);
      collectorCraft.quaternion.copy(threeState.current.chaserTargetQuat);
    }

    // Resize handler
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Main animation loop
    const animate = () => {
      threeState.current.reqId = requestAnimationFrame(animate);

      if (simRunningRef.current) {
        metSecondsRef.current += 0.016;
        if (earthMesh) earthMesh.rotation.y += 0.0003;

        const curT = targetRef.current;
        const activeObj = debrisObjects.get(curT.id);
        const isNeutral = neutralizedSetRef.current.has(curT.id);

        // Adjust active object distance based on slider range
        if (activeObj && collectorCraft && !isNeutral) {
          const dir = activeObj.position.clone().sub(collectorCraft.position).normalize();
          activeObj.position.copy(collectorCraft.position).add(dir.multiplyScalar(rangeRef.current));
        }

        // Chaser slew towards locked target
        if (collectorCraft && activeObj && !isNeutral) {
          const craftForward = new THREE.Vector3(0, 0, 1).applyQuaternion(collectorCraft.quaternion);
          const desiredDir = new THREE.Vector3().subVectors(activeObj.position, collectorCraft.position).normalize();
          const dot = Math.max(-1, Math.min(1, craftForward.dot(desiredDir)));
          const devDeg = THREE.MathUtils.radToDeg(Math.acos(dot));
          setAttitudeError(+devDeg.toFixed(1));

          const slerpSpeed = isStabilizingAttitudeRef.current ? 0.25 : 0.08;
          collectorCraft.quaternion.slerp(threeState.current.chaserTargetQuat, slerpSpeed);
        }

        // Aim Laser
        if (aimRayLine && collectorCraft && activeObj && !isNeutral) {
          aimRayLine.visible = true;
          const pos = aimRayLine.geometry.attributes.position.array as Float32Array;
          const nose = new THREE.Vector3(0, 0, 1.85)
            .applyQuaternion(collectorCraft.quaternion)
            .add(collectorCraft.position);
          pos[0] = nose.x; pos[1] = nose.y; pos[2] = nose.z;
          pos[3] = activeObj.position.x; pos[4] = activeObj.position.y; pos[5] = activeObj.position.z;
          aimRayLine.geometry.attributes.position.needsUpdate = true;
        } else if (aimRayLine) {
          aimRayLine.visible = false;
        }

        // Detumble Beam & Rings alignment
        if (detumbleBeamMesh && detumbleRingsMesh && activeObj && collectorCraft && isDetumblingRef.current) {
          const nose = new THREE.Vector3(0, 0, 1.85)
            .applyQuaternion(collectorCraft.quaternion)
            .add(collectorCraft.position);
          const midPoint = new THREE.Vector3().addVectors(nose, activeObj.position).multiplyScalar(0.5);
          detumbleBeamMesh.position.copy(midPoint);
          detumbleBeamMesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            activeObj.position.clone().sub(nose).normalize()
          );
          (detumbleBeamMesh.material as THREE.MeshBasicMaterial).opacity = 0.8;
          detumbleRingsMesh.position.copy(activeObj.position);
          (detumbleRingsMesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
          detumbleRingsMesh.rotation.y += 0.08;
          detumbleRingsMesh.rotation.x += 0.05;
        }

        // Rotate debris objects
        debrisObjects.forEach((obj, id) => {
          if (obj.visible) {
            const spinVal = id === curT.id ? spinRef.current : obj.userData.data.spin;
            const spinRad = THREE.MathUtils.degToRad(spinVal) * 0.016;
            obj.userData.coreMesh.rotation.y += spinRad;
            obj.userData.coreMesh.rotation.x += spinRad * 0.5;
          }
        });

        // Net deployment animation
        const cStep = captureStepRef.current;
        if ((cStep === 'firing_net' || cStep === 'secured' || cStep === 'deorbiting') && netMesh && activeObj) {
          netMesh.position.lerp(activeObj.position, 0.09);
          netMesh.rotation.y += 0.04;
          if (tetherLine && collectorCraft) {
            const tPos = tetherLine.geometry.attributes.position.array as Float32Array;
            tPos[0] = collectorCraft.position.x;
            tPos[1] = collectorCraft.position.y;
            tPos[2] = collectorCraft.position.z;
            tPos[3] = netMesh.position.x;
            tPos[4] = netMesh.position.y;
            tPos[5] = netMesh.position.z;
            tetherLine.geometry.attributes.position.needsUpdate = true;
          }
        }

        // Camera control target
        if (controls) {
          const mode = camModeRef.current;
          if (mode === 'tactical') {
            controls.target.set(0, 4, 10);
          } else if (mode === 'chaser' && collectorCraft) {
            controls.target.copy(collectorCraft.position);
          } else if (mode === 'target' && activeObj) {
            controls.target.copy(activeObj.position);
          }
          controls.update();
        }
      }

      if (renderer && scene && camera) {
        renderer.render(scene, camera);
      }
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (threeState.current.reqId) {
        cancelAnimationFrame(threeState.current.reqId);
      }
      renderer.dispose();
      container.innerHTML = '';
    };
  }, []);

  // Auto scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Sync debris visibility when neutralized set changes
  useEffect(() => {
    const state = threeState.current;
    state.debrisObjects.forEach((obj, id) => {
      obj.visible = !neutralizedSet.has(id);
    });
  }, [neutralizedSet]);

  const filteredTargets = DEBRIS_DATABASE.filter(item => {
    if (filter === 'all') return true;
    return item.type === filter;
  });

  return (
    <div className="bg-[#0a0e18] text-[#e0e6f5] antialiased min-h-screen lg:h-screen w-screen flex flex-col font-sans select-none overflow-x-hidden lg:overflow-hidden">
      
      {/* TOP DECK HEADER */}
      <header className="bg-[#0a0e18]/95 backdrop-blur-md border-b border-[#283446]/50 px-4 py-2.5 flex flex-wrap items-center justify-between z-30 shrink-0 gap-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#22d3ee]/20 border border-[#22d3ee]/40 flex items-center justify-center text-[#8aebff] shadow-[0_0_12px_rgba(34,211,238,0.3)]">
              <span className="material-symbols-outlined text-lg">science</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold tracking-wider text-sm sm:text-base text-white">ORBITCATCH</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#8aebff]/10 text-[#8aebff] border border-[#8aebff]/30 uppercase font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8aebff] animate-ping" />
                  PROTOTYPER
                </span>
              </div>
              <p className="text-[10px] text-[#94a3b8] font-mono hidden sm:block">Autonomous Orbital Net Capture &amp; De-Orbit Lab</p>
            </div>
          </div>

          <div className="hidden sm:block h-5 w-px bg-[#283446]/60" />

          {/* Phase Badge */}
          <div className="flex items-center gap-1.5 bg-[#131722] px-2.5 py-1 rounded-full border border-[#283446]/40">
            <span className="text-[10px] font-mono text-[#94a3b8] uppercase font-semibold">Phase:</span>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold flex items-center gap-1.5 bg-[#46d89d]/20 text-[#68f5b8] border border-[#68f5b8]/40">
              <span className="w-2 h-2 rounded-full bg-[#68f5b8] animate-pulse" />
              <span>{phase}</span>
            </span>
          </div>

          {/* Spacecraft Attitude Stabilization Pill */}
          <div className="flex items-center gap-2 bg-[#131722] px-2.5 py-1 rounded-full border border-[#8aebff]/30">
            <span className="material-symbols-outlined text-xs text-[#8aebff]">adjust</span>
            <span className={`text-[10px] font-mono font-bold ${isStabilizingAttitude ? 'text-[#68f5b8] animate-pulse' : 'text-[#8aebff]'}`}>
              {isStabilizingAttitude ? 'ACS // DAMPING RATES' : 'ACS // STABILIZED'}
            </span>
            <span className="text-[10px] font-mono text-[#94a3b8]">{attitudeError.toFixed(1)}° Err</span>
            <button
              onClick={handleStabilizeACS}
              className="px-2 py-0.5 rounded bg-[#8aebff]/15 hover:bg-[#22d3ee] hover:text-[#10131d] text-[#8aebff] border border-[#8aebff]/40 font-mono text-[9px] font-bold uppercase transition-all flex items-center gap-1 cursor-pointer active:scale-95"
              title="Fire RCS Quads to Damp Slew Error"
            >
              <span className="material-symbols-outlined text-[11px]">filter_tilt_shift</span>
              <span>STABILIZE ACS</span>
            </button>
          </div>

          {/* Neutralized Counter & Sector Safety */}
          <div className="hidden md:flex items-center gap-2 bg-[#131722] px-3 py-1 rounded-full border border-[#68f5b8]/40">
            <span className="material-symbols-outlined text-[#68f5b8] text-sm">recycling</span>
            <div className="text-[10px] font-mono">
              <span className="text-[#94a3b8]">Neutralized: </span>
              <span className="font-bold text-[#68f5b8]">{neutralizedCount}</span>
              <span className="text-[#94a3b8] ml-1">
                | Sector: <span className="text-[#8aebff] font-semibold">{sectorSafetyPct}%</span>
              </span>
            </div>
          </div>
        </div>

        {/* Header Preset Scenarios and Play/Pause/Abort Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center bg-[#131722] p-1 rounded-lg border border-[#283446]/40 gap-1">
            <button
              onClick={() => handleSelectScenario('nominal')}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
                activeScenario === 'nominal'
                  ? 'bg-[#22d3ee] text-[#10131d]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              A: Nominal
            </button>
            <button
              onClick={() => handleSelectScenario('delta-v-abort')}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
                activeScenario === 'delta-v-abort'
                  ? 'bg-[#22d3ee] text-[#10131d]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              B: High-Vel
            </button>
            <button
              onClick={() => handleSelectScenario('tumble-lockout')}
              className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
                activeScenario === 'tumble-lockout'
                  ? 'bg-[#22d3ee] text-[#10131d]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              C: Spin Hazard
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setSimRunning(!simRunning)}
              className="w-8 h-8 rounded-lg bg-[#131722] border border-[#283446]/50 hover:text-[#8aebff] text-[#e0e6f5] flex items-center justify-center cursor-pointer transition-colors"
              title={simRunning ? 'Pause Simulation' : 'Resume Simulation'}
            >
              <span className="material-symbols-outlined text-base">
                {simRunning ? 'pause' : 'play_arrow'}
              </span>
            </button>
            <button
              onClick={handleResetSimulation}
              className="w-8 h-8 rounded-lg bg-[#131722] border border-[#283446]/50 hover:text-[#8aebff] text-[#94a3b8] flex items-center justify-center cursor-pointer transition-colors"
              title="Reset Simulation"
            >
              <span className="material-symbols-outlined text-base">restart_alt</span>
            </button>
            <button
              onClick={handleEmergencyAbort}
              className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[#7a1e28]/40 border border-[#ff7b72]/70 hover:bg-[#ff7b72] hover:text-white text-[#ff7b72] font-mono text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">shield</span>
              <span>Abort</span>
            </button>
          </div>
        </div>
      </header>

      {/* WORKSPACE 12-COLUMN GRID */}
      <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 overflow-hidden relative min-h-0">

        {/* LEFT PANEL: TARGET MATRIX & GUIDANCE */}
        <aside className="lg:col-span-3 bg-[#131722]/80 backdrop-blur-xl border-r border-[#283446]/40 flex flex-col overflow-hidden z-20">
          <div className="p-3 border-b border-[#283446]/40 flex items-center justify-between bg-[#0a0e18]/60 shrink-0">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#8aebff] text-base">radar</span>
              <h2 className="font-bold text-xs uppercase tracking-wider text-white">Orbital Targets Matrix</h2>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#222736] text-[#94a3b8] font-semibold">
              {DEBRIS_DATABASE.length} TRACKED
            </span>
          </div>

          {/* Filter Bar */}
          <div className="px-3 py-1.5 border-b border-[#283446]/30 flex items-center gap-1.5 bg-[#0a0e18]/40 shrink-0">
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold cursor-pointer transition-all ${
                filter === 'all'
                  ? 'bg-[#22d3ee] text-[#10131d]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              All ({DEBRIS_DATABASE.length})
            </button>
            <button
              onClick={() => setFilter('debris')}
              className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold cursor-pointer transition-all ${
                filter === 'debris'
                  ? 'bg-[#22d3ee] text-[#10131d]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Debris ({DEBRIS_DATABASE.filter(d => d.type === 'debris').length})
            </button>
            <button
              onClick={() => setFilter('asteroid')}
              className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold cursor-pointer transition-all ${
                filter === 'asteroid'
                  ? 'bg-[#22d3ee] text-[#10131d]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Asteroids ({DEBRIS_DATABASE.filter(d => d.type === 'asteroid').length})
            </button>
          </div>

          {/* Active Selection Optimality Card */}
          <div className="p-2.5 border-b border-[#283446]/40 bg-[#181d2a]/60 shrink-0 flex items-center justify-between">
            <div>
              <span className="text-[9px] font-mono text-[#94a3b8] block uppercase">Selected Candidate</span>
              <span className="text-xs font-mono font-bold text-[#8aebff]">{currentTarget.id}</span>
            </div>
            <div className="text-right">
              <span className="text-[9px] font-mono text-[#94a3b8] block uppercase">Optimality</span>
              <span className="text-xs font-mono font-bold text-[#68f5b8]">
                {currentTarget.score} / 100
              </span>
            </div>
          </div>

          {/* Target List Cards */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {filteredTargets.map((item) => {
              const isSelected = item.id === currentTarget.id;
              const isDestroyed = neutralizedSet.has(item.id);

              let badgeClass = 'bg-[#222736] text-[#94a3b8]';
              let statusText = item.status as string;
              if (isDestroyed) {
                badgeClass = 'bg-[#68f5b8]/20 text-[#68f5b8] border border-[#68f5b8]/40';
                statusText = 'NEUTRALIZED';
              } else if (item.status === 'RECOMMENDED' || item.status === 'VIABLE') {
                badgeClass = 'bg-[#68f5b8]/20 text-[#68f5b8] border border-[#68f5b8]/40';
              } else if (item.status === 'ABORT_RISK' || item.status === 'SPIN_HAZARD') {
                badgeClass = 'bg-[#7a1e28]/40 text-[#ff7b72] border border-[#ff7b72]/50';
              }

              return (
                <div
                  key={item.id}
                  onClick={() => selectTarget(item)}
                  className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#22d3ee]/15 border-[#22d3ee] shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                      : 'bg-[#0a0e18]/80 border-[#283446]/40 hover:border-[#8aebff]/40'
                  } ${isDestroyed ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-mono font-bold text-xs ${isSelected ? 'text-[#8aebff]' : 'text-white'}`}>
                      {item.id}
                    </span>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded font-bold uppercase ${badgeClass}`}>
                      {statusText}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#94a3b8] font-mono truncate">{item.name}</div>
                  <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px] font-mono text-[#94a3b8]">
                    <div>Speed: <span className="text-white">{item.speed}m/s</span></div>
                    <div>
                      Spin: <span className={item.spin > 6 ? 'text-[#ff7b72] font-bold' : 'text-white'}>{item.spin}&deg;/s</span>
                    </div>
                    <div>Range: <span className="text-white">{item.range}m</span></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Direct Stabilization & Despin Guidance Box */}
          <div className="p-3 border-t border-[#283446]/40 bg-[#0a0e18]/80 shrink-0 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-[#8aebff]">
                <span className="material-symbols-outlined text-sm">cyclone</span>
                <span>Target Despin / Stabilize</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#68f5b8]/10 text-[#68f5b8] border border-[#68f5b8]/20">
                EDDY BRAKE
              </span>
            </div>
            <p className="text-[10px] font-mono text-[#94a3b8] leading-relaxed">
              {currentTarget.note}
            </p>
            <button
              onClick={() => handleDetumbleTarget(0.2)}
              disabled={isDetumbling}
              className="w-full py-2 px-3 rounded-lg bg-[#68f5b8]/15 hover:bg-[#68f5b8] hover:text-[#10131d] border border-[#68f5b8]/50 text-[#68f5b8] font-mono text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-[0_0_12px_rgba(104,245,184,0.15)] cursor-pointer active:scale-98 disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-base ${isDetumbling ? 'animate-spin' : ''}`}>
                rotate_left
              </span>
              <span>{isDetumbling ? 'BRAKING EDDY CURRENTS...' : 'STABILIZE TARGET SPIN'}</span>
            </button>
          </div>
        </aside>

        {/* CENTER MAIN: 3D VIEWPORT & HUD OVERLAYS */}
        <main className="lg:col-span-6 relative bg-[#0a0e18] overflow-hidden flex flex-col border-r border-[#283446]/40 min-h-[350px]">
          {/* Three.js Container */}
          <div ref={threeContainerRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing overflow-hidden" />

          {/* HUD Overlay Interface */}
          <div className="absolute inset-0 pointer-events-none hud-grid flex flex-col justify-between p-3 sm:p-4 z-10">
            {/* Top HUD Controls & Reticle */}
            <div className="flex items-start justify-between pointer-events-auto gap-2">
              {/* Camera Modes Switcher */}
              <div className="flex items-center gap-1 bg-[#0a0e18]/90 backdrop-blur-md p-1 rounded-lg border border-[#283446]/50">
                <button
                  onClick={() => setCamMode('tactical')}
                  className={`px-2.5 py-1 text-xs font-mono font-semibold rounded cursor-pointer transition-all ${
                    camMode === 'tactical'
                      ? 'bg-[#22d3ee] text-[#10131d]'
                      : 'text-[#94a3b8] hover:text-white'
                  }`}
                >
                  Tactical Orbit
                </button>
                <button
                  onClick={() => setCamMode('chaser')}
                  className={`px-2.5 py-1 text-xs font-mono font-semibold rounded cursor-pointer transition-all ${
                    camMode === 'chaser'
                      ? 'bg-[#22d3ee] text-[#10131d]'
                      : 'text-[#94a3b8] hover:text-white'
                  }`}
                >
                  Chaser Chase
                </button>
                <button
                  onClick={() => setCamMode('target')}
                  className={`px-2.5 py-1 text-xs font-mono font-semibold rounded cursor-pointer transition-all ${
                    camMode === 'target'
                      ? 'bg-[#22d3ee] text-[#10131d]'
                      : 'text-[#94a3b8] hover:text-white'
                  }`}
                >
                  Target Close
                </button>
              </div>

              {/* Live Target Telemetry Box */}
              <div className="bg-[#0a0e18]/90 backdrop-blur-md px-3 py-2 rounded-lg border border-[#283446]/50 shadow-xl min-w-[200px]">
                <div className="flex items-center justify-between border-b border-[#283446]/40 pb-1 mb-1">
                  <span className="text-[10px] font-mono text-[#8aebff] uppercase font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#8aebff] animate-pulse" />
                    LOCKED TRACK
                  </span>
                  <span className="text-xs font-mono font-bold text-white">{currentTarget.id}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div>
                    <span className="text-[9px] text-[#94a3b8] block uppercase">Range:</span>
                    <span className="text-xs font-bold text-white">{range.toFixed(1)} m</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-[#94a3b8] block uppercase">Closing Rate:</span>
                    <span className={`text-xs font-bold ${passSpeed ? 'text-[#68f5b8]' : 'text-[#ff7b72]'}`}>
                      {speed.toFixed(2)} m/s
                    </span>
                  </div>
                </div>
                <div className="mt-1 pt-1 border-t border-[#283446]/30 flex justify-between items-center text-[10px] font-mono">
                  <span className="text-[#94a3b8]">Bearing Dev:</span>
                  <span className="font-bold text-[#8aebff]">{attitudeError.toFixed(1)} &deg;</span>
                </div>
                <div className="mt-0.5 flex justify-between items-center text-[10px] font-mono">
                  <span className="text-[#94a3b8]">Target Spin:</span>
                  <span className={`font-bold ${passSpin ? 'text-[#68f5b8]' : 'text-[#ff7b72]'}`}>
                    {spin.toFixed(1)} &deg;/s
                  </span>
                </div>
              </div>
            </div>

            {/* Center Dynamic Status Notification Banner */}
            <div className="pointer-events-auto max-w-md mx-auto w-full transition-all">
              {isCurrentNeutralized ? (
                <div className="bg-[#0a0e18]/95 border-2 border-[#68f5b8]/80 rounded-xl p-3 flex items-center justify-between shadow-[0_0_20px_rgba(104,245,184,0.3)]">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#68f5b8] text-xl">check_circle</span>
                    <div>
                      <span className="text-xs font-mono font-bold text-white uppercase block">
                        {currentTarget.id} NEUTRALIZED
                      </span>
                      <span className="text-[10px] font-mono text-[#68f5b8]">Atmospheric de-orbit complete. Sector clear.</span>
                    </div>
                  </div>
                  <button
                    onClick={handleAcquireNext}
                    className="px-3 py-1.5 rounded-lg bg-[#68f5b8] text-[#10131d] font-mono text-xs font-bold uppercase hover:bg-white transition-all cursor-pointer"
                  >
                    Next Target &rarr;
                  </button>
                </div>
              ) : allNominal ? (
                <div className="bg-[#68f5b8]/15 border border-[#68f5b8]/40 backdrop-blur-md rounded-lg p-2.5 flex items-center justify-between shadow-md">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#68f5b8] text-base">verified</span>
                    <span className="text-xs font-mono font-semibold text-white">Capture Envelope Nominal: Ready to Fire</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#68f5b8] text-[#10131d] font-bold uppercase">READY</span>
                </div>
              ) : (
                <div className="bg-[#7a1e28]/40 border border-[#ff7b72]/70 backdrop-blur-md rounded-lg p-2.5 flex items-center justify-between shadow-lg">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#ff7b72] text-lg animate-pulse">lock</span>
                    <div>
                      <span className="text-xs font-mono font-bold text-[#ff7b72] uppercase">SAFETY INTERLOCK ACTIVE</span>
                      <p className="text-[10px] font-mono text-white/90 leading-tight">
                        {!passSpin
                          ? 'Spin > 6.0 °/s (Tether Wrap Risk)'
                          : !passSpeed
                          ? 'Speed > 1.20 m/s'
                          : 'Range > 25m'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      handleDetumbleTarget(0.2);
                      setSpeed(0.45);
                      setRange(16.0);
                    }}
                    className="px-2.5 py-1 rounded bg-[#68f5b8] text-[#10131d] font-mono text-[10px] font-bold uppercase hover:bg-white transition-all cursor-pointer"
                  >
                    Stabilize &amp; Clear
                  </button>
                </div>
              )}
            </div>

            {/* Net Capture Cone Visual Reticle Center Overlay */}
            <div className="pointer-events-none self-center flex flex-col items-center justify-center opacity-70">
              <div className="relative w-24 h-24 border border-[#8aebff]/30 rounded-full flex items-center justify-center">
                <div className="w-16 h-16 border border-[#8aebff]/50 rounded-full pulse-glow" />
                <div className="absolute w-2 h-2 bg-[#8aebff] rounded-full" />
                <div className="absolute top-0 w-0.5 h-2 bg-[#8aebff]" />
                <div className="absolute bottom-0 w-0.5 h-2 bg-[#8aebff]" />
                <div className="absolute left-0 h-0.5 w-2 bg-[#8aebff]" />
                <div className="absolute right-0 h-0.5 w-2 bg-[#8aebff]" />
                <span className="absolute -bottom-5 font-mono text-[9px] text-[#8aebff]/80 tracking-widest uppercase">
                  NET CAPTURE CONE
                </span>
              </div>
            </div>

            {/* Bottom HUD Bar */}
            <div className="pointer-events-auto bg-[#0a0e18]/90 backdrop-blur-md px-3 py-2 rounded-xl border border-[#283446]/50 flex flex-wrap items-center justify-between gap-2 shadow-2xl">
              <div className="flex items-center gap-3 text-xs font-mono">
                <div>
                  <span className="text-[9px] text-[#94a3b8] block uppercase font-medium">Capture Net</span>
                  <span className="font-bold text-[#8aebff] text-xs">ARMED // READY</span>
                </div>
                <div className="h-4 w-px bg-[#283446]/50" />
                <div>
                  <span className="text-[9px] text-[#94a3b8] block uppercase font-medium">ACS Status</span>
                  <span className="font-bold text-[#68f5b8] text-xs">BORESIGHT LOCKED</span>
                </div>
                <div className="h-4 w-px bg-[#283446]/50" />
                <div>
                  <span className="text-[9px] text-[#94a3b8] block uppercase font-medium">Target Spin</span>
                  <span className={`font-bold text-xs ${passSpin ? 'text-[#68f5b8]' : 'text-[#ff7b72] animate-pulse'}`}>
                    {passSpin ? 'STABLE (≤ 6°/s)' : 'HAZARDOUS SPIN'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleStabilizeACS}
                  className="px-2.5 py-1 rounded-lg bg-[#222736] hover:bg-[#181d2a] border border-[#8aebff]/40 hover:border-[#8aebff] text-xs font-mono text-[#8aebff] flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                  title="Cancel Slew Error and Dampen Rates"
                >
                  <span className="material-symbols-outlined text-sm">filter_tilt_shift</span>
                  <span>Damp Attitude</span>
                </button>
                <button
                  onClick={() => handleDetumbleTarget(0.2)}
                  className="px-2.5 py-1 rounded-lg bg-[#222736] hover:bg-[#181d2a] border border-[#68f5b8]/40 hover:border-[#68f5b8] text-xs font-mono text-[#68f5b8] flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                  title="Apply Eddy Current Brakes to Stop Target Rotation"
                >
                  <span className="material-symbols-outlined text-sm">cyclone</span>
                  <span>Despin Target</span>
                </button>
                {isCurrentNeutralized && (
                  <button
                    onClick={handleAcquireNext}
                    className="px-3 py-1 rounded-lg bg-[#22d3ee] text-[#10131d] font-mono text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">double_arrow</span>
                    <span>Next Target</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* RIGHT PANEL: SAFETY INTERLOCK GATES & EVENT FEED */}
        <aside className="lg:col-span-3 bg-[#131722]/80 backdrop-blur-xl flex flex-col overflow-y-auto z-20">
          <div className="p-3 border-b border-[#283446]/40 bg-[#0a0e18]/60 shrink-0 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#8aebff] text-base">verified_user</span>
              <h2 className="font-bold text-xs uppercase tracking-wider text-white">Safety Interlock Gates</h2>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                allNominal
                  ? 'bg-[#46d89d]/30 text-[#68f5b8] border border-[#68f5b8]/60'
                  : 'bg-[#7a1e28]/40 text-[#ff7b72] border border-[#ff7b72]/60 animate-pulse'
              }`}
            >
              {allNominal ? 'ALL GATES GO' : 'INTERLOCK TRIPPED'}
            </span>
          </div>

          {/* 4 Gates Breakdown */}
          <div className="p-3 space-y-2 border-b border-[#283446]/40 shrink-0">
            {/* Gate 1: Range */}
            <div className="p-2.5 rounded-lg bg-[#0a0e18]/90 border border-[#283446]/40 flex items-center justify-between text-xs font-mono">
              <div>
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${passRange ? 'bg-[#68f5b8] shadow-[0_0_6px_#68f5b8]' : 'bg-[#ff7b72] shadow-[0_0_6px_#ff7b72]'}`} />
                  Gate 1: Range &le; 25.0 m
                </div>
                <div className="text-[11px] text-[#94a3b8] mt-0.5">
                  Current: <span className="font-bold text-white">{range.toFixed(1)} m</span>
                </div>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  passRange ? 'bg-[#46d89d]/20 text-[#68f5b8]' : 'bg-[#7a1e28]/40 text-[#ff7b72]'
                }`}
              >
                {passRange ? 'PASS' : 'FAIL'}
              </span>
            </div>

            {/* Gate 2: Speed */}
            <div className="p-2.5 rounded-lg bg-[#0a0e18]/90 border border-[#283446]/40 flex items-center justify-between text-xs font-mono">
              <div>
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${passSpeed ? 'bg-[#68f5b8] shadow-[0_0_6px_#68f5b8]' : 'bg-[#ff7b72] shadow-[0_0_6px_#ff7b72]'}`} />
                  Gate 2: Speed &le; 1.20 m/s
                </div>
                <div className="text-[11px] text-[#94a3b8] mt-0.5">
                  Current: <span className="font-bold text-white">{speed.toFixed(2)} m/s</span>
                </div>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  passSpeed ? 'bg-[#46d89d]/20 text-[#68f5b8]' : 'bg-[#7a1e28]/40 text-[#ff7b72]'
                }`}
              >
                {passSpeed ? 'PASS' : 'FAIL'}
              </span>
            </div>

            {/* Gate 3: Spin / Tumble with direct stabilize button */}
            <div className="p-2.5 rounded-lg bg-[#0a0e18]/90 border border-[#283446]/40 text-xs font-mono">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${passSpin ? 'bg-[#68f5b8] shadow-[0_0_6px_#68f5b8]' : 'bg-[#ff7b72] shadow-[0_0_6px_#ff7b72]'}`} />
                    Gate 3: Spin &le; 6.0 &deg;/s
                  </div>
                  <div className="text-[11px] text-[#94a3b8] mt-0.5">
                    Current: <span className="font-bold text-white">{spin.toFixed(1)} &deg;/s</span>
                  </div>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    passSpin ? 'bg-[#46d89d]/20 text-[#68f5b8]' : 'bg-[#7a1e28]/40 text-[#ff7b72]'
                  }`}
                >
                  {passSpin ? 'PASS' : 'FAIL'}
                </span>
              </div>
              <div className="mt-2 pt-1.5 border-t border-[#283446]/30 flex items-center justify-between">
                <span className="text-[9px] text-[#94a3b8]">Tether wrap hazard:</span>
                <button
                  onClick={() => handleDetumbleTarget(0.2)}
                  className="px-2 py-0.5 rounded bg-[#68f5b8]/20 hover:bg-[#68f5b8] text-[#68f5b8] hover:text-[#10131d] border border-[#68f5b8]/40 text-[9px] font-mono font-bold uppercase transition-all flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[11px]">rotate_left</span>
                  <span>STABILIZE (0.2&deg;/s)</span>
                </button>
              </div>
            </div>

            {/* Gate 4: Confidence */}
            <div className="p-2.5 rounded-lg bg-[#0a0e18]/90 border border-[#283446]/40 flex items-center justify-between text-xs font-mono">
              <div>
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${passConf ? 'bg-[#68f5b8] shadow-[0_0_6px_#68f5b8]' : 'bg-[#ff7b72] shadow-[0_0_6px_#ff7b72]'}`} />
                  Gate 4: Sensor Conf &ge; 90%
                </div>
                <div className="text-[11px] text-[#94a3b8] mt-0.5">
                  Current: <span className="font-bold text-white">{confidence.toFixed(1)}%</span>
                </div>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  passConf ? 'bg-[#46d89d]/20 text-[#68f5b8]' : 'bg-[#7a1e28]/40 text-[#ff7b72]'
                }`}
              >
                {passConf ? 'PASS' : 'FAIL'}
              </span>
            </div>
          </div>

          {/* Orbital Traffic Clearance Check */}
          <div className="p-2.5 border-b border-[#283446]/40 bg-[#181d2a]/30 shrink-0 flex items-center justify-between font-mono text-[11px]">
            <div>
              <span className="font-bold text-white">STARLINK-4921</span>
              <span className="text-[10px] text-[#94a3b8] block">Miss dist: 2.4 km &bull; Safe</span>
            </div>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#46d89d]/20 text-[#68f5b8]">
              COLA CLEAR
            </span>
          </div>

          {/* Activity Terminal Feed */}
          <div className="flex-1 flex flex-col p-3 overflow-hidden min-h-[140px]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-bold text-xs uppercase tracking-wider text-white flex items-center gap-1">
                <span className="material-symbols-outlined text-[#8aebff] text-sm">terminal</span> Mission Activity
              </span>
              <button
                onClick={() => setLogs([])}
                className="text-[10px] font-mono text-[#94a3b8] hover:text-white uppercase transition-colors cursor-pointer"
              >
                Clear
              </button>
            </div>
            <div className="flex-1 bg-[#0a0e18]/90 p-2.5 rounded-lg border border-[#283446]/30 font-mono text-[11px] overflow-y-auto space-y-1.5">
              {logs.map((log) => {
                let tagColor = 'text-[#8aebff]';
                if (log.type === 'alert') tagColor = 'text-[#ff7b72]';
                if (log.type === 'success') tagColor = 'text-[#68f5b8]';
                if (log.type === 'warn') tagColor = 'text-[#f59e0b]';

                return (
                  <div key={log.id} className="flex items-start gap-1.5 leading-snug">
                    <span className="text-[#94a3b8]/70 text-[10px] shrink-0">{log.time}</span>
                    <span className={`font-bold ${tagColor}`}>[{log.tag}]</span>
                    <span className="text-[#e0e6f5]/90 text-[11px] break-words">{log.text}</span>
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          </div>
        </aside>
      </div>

      {/* BOTTOM DOCKED PARAMETER LAB */}
      <section className="bg-[#131722]/95 backdrop-blur-xl border-t border-[#283446]/60 z-30 shrink-0">
        <div className="px-4 py-1.5 border-b border-[#283446]/40 flex items-center justify-between bg-[#0a0e18]/80">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#8aebff] text-sm">tune</span>
            <h3 className="font-bold text-xs font-mono uppercase tracking-wider text-white">
              Mission Prototyper &amp; Parameter Lab
            </h3>
            <span className="text-[10px] font-mono text-[#94a3b8] hidden md:inline">
              &mdash; Real-time flight dynamics &amp; stabilization testbed
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleApplyPreset('nominal')}
              className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#181d2a] hover:bg-[#222736] border border-[#283446]/50 text-white transition-all cursor-pointer"
            >
              Nominal Net Deploy
            </button>
            <button
              onClick={() => handleApplyPreset('high-vel')}
              className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#181d2a] hover:bg-[#222736] border border-[#283446]/50 text-[#94a3b8] hover:text-white transition-all cursor-pointer"
            >
              Velocity Exceeded
            </button>
            <button
              onClick={() => handleApplyPreset('spin-lockout')}
              className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#181d2a] hover:bg-[#222736] border border-[#283446]/50 text-[#94a3b8] hover:text-white transition-all cursor-pointer"
            >
              High Tumble Lockout
            </button>
            <button
              onClick={() => handleApplyPreset('stabilize-all')}
              className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#68f5b8]/20 hover:bg-[#68f5b8] text-[#68f5b8] hover:text-[#10131d] border border-[#68f5b8]/40 font-bold transition-all cursor-pointer"
            >
              Stabilize &amp; Despin
            </button>
          </div>
        </div>

        {/* Sliders and Capture Action Area */}
        <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Closing Speed Slider */}
          <div className="md:col-span-3 space-y-1 bg-[#181d2a]/60 p-2 rounded-lg border border-[#283446]/30">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-[#94a3b8]">Closing Speed (Gate 2)</span>
              <span className={`font-bold ${passSpeed ? 'text-[#68f5b8]' : 'text-[#ff7b72]'}`}>
                {speed.toFixed(2)} m/s
              </span>
            </div>
            <input
              type="range"
              min="0.1"
              max="3.0"
              step="0.05"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="flex justify-between text-[9px] font-mono text-[#94a3b8]">
              <span>0.1 m/s</span>
              <span className="text-[#8aebff]">Limit: &le; 1.20</span>
              <span>3.0 m/s</span>
            </div>
          </div>

          {/* Tumble Rate Slider with Direct Despin Action */}
          <div className="md:col-span-3 space-y-1 bg-[#181d2a]/60 p-2 rounded-lg border border-[#283446]/30">
            <div className="flex justify-between items-center text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="text-[#94a3b8]">Tumble Rate (Gate 3)</span>
                <button
                  onClick={() => handleDetumbleTarget(0.2)}
                  className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#68f5b8]/20 hover:bg-[#68f5b8] text-[#68f5b8] hover:text-[#10131d] font-bold transition-colors cursor-pointer"
                  title="Despin target to safe rate"
                >
                  DESPIN
                </button>
              </div>
              <span className={`font-bold ${passSpin ? 'text-[#68f5b8]' : 'text-[#ff7b72]'}`}>
                {spin.toFixed(1)} &deg;/s
              </span>
            </div>
            <input
              type="range"
              min="0.0"
              max="25.0"
              step="0.5"
              value={spin}
              onChange={(e) => setSpin(parseFloat(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="flex justify-between text-[9px] font-mono text-[#94a3b8]">
              <span>0.0 &deg;/s</span>
              <span className="text-[#8aebff]">Limit: &le; 6.0</span>
              <span>25.0 &deg;/s</span>
            </div>
          </div>

          {/* Standoff Range Slider */}
          <div className="md:col-span-3 space-y-1 bg-[#181d2a]/60 p-2 rounded-lg border border-[#283446]/30">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-[#94a3b8]">Standoff Range (Gate 1)</span>
              <span className={`font-bold ${passRange ? 'text-white' : 'text-[#ff7b72]'}`}>
                {range.toFixed(1)} m
              </span>
            </div>
            <input
              type="range"
              min="5.0"
              max="40.0"
              step="1.0"
              value={range}
              onChange={(e) => setRange(parseFloat(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="flex justify-between text-[9px] font-mono text-[#94a3b8]">
              <span>5 m</span>
              <span className="text-[#8aebff]">Limit: &le; 25.0</span>
              <span>40 m</span>
            </div>
          </div>

          {/* Net Execution Action Button */}
          <div className="md:col-span-3 flex flex-col gap-1 justify-center">
            {isCurrentNeutralized ? (
              <button
                onClick={handleAcquireNext}
                className="w-full min-h-[42px] py-2 px-4 rounded-xl bg-[#22d3ee] hover:bg-[#8aebff] text-[#10131d] font-mono text-xs sm:text-sm font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_18px_rgba(34,211,238,0.4)] transition-all"
              >
                <span className="material-symbols-outlined text-lg">double_arrow</span>
                <span>ACQUIRE NEXT TARGET</span>
              </button>
            ) : allNominal ? (
              <button
                onClick={handleExecuteCapture}
                disabled={captureStep !== 'idle'}
                className="w-full min-h-[42px] py-2 px-4 rounded-xl bg-[#68f5b8] hover:bg-white text-[#10131d] font-mono text-xs sm:text-sm font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_18px_rgba(104,245,184,0.4)] cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-lg">
                  {captureStep === 'idle' ? 'rocket_launch' : 'hourglass_top'}
                </span>
                <span>
                  {captureStep === 'idle'
                    ? 'EXECUTE CAPTURE NET'
                    : captureStep === 'approaching'
                    ? 'APPROACHING TARGET...'
                    : captureStep === 'firing_net'
                    ? 'FIRING KEVLAR NET...'
                    : captureStep === 'secured'
                    ? 'DRAWSTRINGS TIGHTENED...'
                    : 'DE-ORBITING TARGET...'}
                </span>
              </button>
            ) : (
              <button
                disabled
                className="w-full min-h-[42px] py-2 px-4 rounded-xl bg-[#181d2a] border border-[#ff7b72]/50 text-[#ff7b72] font-mono text-xs sm:text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2 cursor-not-allowed opacity-80"
              >
                <span className="material-symbols-outlined text-lg">lock</span>
                <span>DEPLOYMENT INHIBITED</span>
              </button>
            )}

            <div
              className={`text-center font-mono text-[10px] ${
                isCurrentNeutralized
                  ? 'text-[#68f5b8]'
                  : allNominal
                  ? 'text-[#68f5b8]'
                  : 'text-[#ff7b72] font-semibold'
              }`}
            >
              {isCurrentNeutralized
                ? 'De-orbit Disposal Verified (+1 Cleared)'
                : allNominal
                ? 'All 4 Safety Gates Verified Nominal'
                : `Safety Lockout: ${
                    !passSpin
                      ? 'Spin > 6.0 °/s (Tether Wrap Risk)'
                      : !passSpeed
                      ? 'Speed > 1.20 m/s'
                      : 'Range > 25.0 m'
                  }`}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
