// Minimal WebGL renderer and accessible interactions for the Desktop-8 page.
(() => {
  const root = document.documentElement;
  const canvas = document.querySelector('#city-canvas');
  const sceneStatus = document.querySelector('#scene-status');
  const locationButtons = [...document.querySelectorAll('.scene-point')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionToggle = document.querySelector('#motion-toggle');

  const spotlightBody = () => {
    if (!document.body) return;

    const setSpotlightPosition = (clientX, clientY) => {
      const x = `${(clientX / window.innerWidth) * 100}%`;
      const y = `${(clientY / window.innerHeight) * 100}%`;
      document.documentElement.style.setProperty('--spot-x', x);
      document.documentElement.style.setProperty('--spot-y', y);
      document.body.classList.add('is-spotlighting');
    };

    document.addEventListener('pointermove', (event) => {
      setSpotlightPosition(event.clientX, event.clientY);
    });

    document.addEventListener('pointerleave', () => {
      document.body.classList.remove('is-spotlighting');
    });

    document.addEventListener('pointerenter', (event) => {
      setSpotlightPosition(event.clientX, event.clientY);
      document.body.classList.add('is-spotlighting');
    });

    window.addEventListener('blur', () => {
      document.body.classList.remove('is-spotlighting');
    });
  };

  spotlightBody();

  const locations = [
    {
      name: 'The Ninth Annex',
      copy: 'The Ninth Annex is sealed, but the contract shelves still glow beneath the locked door.',
    },
    {
      name: 'Wibisono Meridian',
      copy: 'A drowned district appears on the map only after midnight. Its old municipal records remain active.',
    },
    {
      name: 'The Shut Room',
      copy: 'No key has opened the Shut Room. Every visitor leaves with a different account of what they heard.',
    },
  ];

  let selectedLocation = 0;
  let paused = reducedMotion.matches;
  let frameRequest = 0;
  let startTime = 0;
  let pointerX = 0.5;
  let pointerY = 0.5;
  let renderer = null;
  let resizeObserver = null;

  root.dataset.motion = paused ? 'off' : 'on';

  function announce(message) {
    if (sceneStatus) sceneStatus.textContent = message;
  }

  function updateLocation(index) {
    selectedLocation = index;
    locationButtons.forEach((button) => {
      const active = Number(button.dataset.location) === index;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    announce(locations[index].copy);
    renderer?.draw(performance.now());
  }

  locationButtons.forEach((button) => {
    button.addEventListener('click', () => updateLocation(Number(button.dataset.location)));
  });

  const vertexShader = `
    attribute vec2 a_position;
    varying vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentShader = `
    precision highp float;
    varying vec2 v_uv;
    uniform vec2 u_resolution;
    uniform vec2 u_pointer;
    uniform float u_time;
    uniform float u_selected;

    float hash(float n) {
      return fract(sin(n) * 43758.5453123);
    }

    void main() {
      vec2 uv = v_uv;
      float aspect = u_resolution.x / max(u_resolution.y, 1.0);
      uv.x += (u_pointer.x - 0.5) * 0.045;
      uv.y += (u_pointer.y - 0.5) * 0.018;

      float horizon = 0.53 + 0.018 * sin(uv.x * 7.0 + u_time * 0.08);
      float skyTone = mix(0.68, 0.37, smoothstep(0.16, 0.78, uv.y));
      skyTone += 0.13 * exp(-pow((uv.y - horizon - 0.05) * 7.0, 2.0));
      vec3 color = vec3(skyTone);

      float cell = floor(uv.x * 22.0);
      float localX = fract(uv.x * 22.0);
      float buildingHeight = 0.13 + hash(cell + 4.0) * 0.26;
      float buildingTop = horizon + buildingHeight;
      float building = step(uv.y, buildingTop) * step(0.035, localX) * step(localX, 0.965);
      float facade = 0.19 + 0.12 * hash(cell + 8.0);
      color = mix(color, vec3(facade), building);

      vec2 windowGrid = vec2(fract(uv.x * 22.0 * 5.0), fract(uv.y * 31.0));
      float windowRows = step(horizon + 0.035, uv.y) * step(uv.y, buildingTop - 0.018);
      float litWindow = step(0.66, hash(cell * 8.0 + floor(uv.y * 31.0) * 13.0));
      float windowShape = step(0.18, windowGrid.x) * step(windowGrid.x, 0.56)
        * step(0.16, windowGrid.y) * step(windowGrid.y, 0.72);
      float glow = windowRows * windowShape * litWindow;
      color = mix(color, vec3(0.76), glow * 0.65);

      float street = 1.0 - smoothstep(0.0, 0.40, uv.y);
      float roadLines = 1.0 - smoothstep(0.0, 0.015, abs(fract(uv.y * 20.0 + uv.x * 1.7) - 0.5));
      color = mix(color, vec3(0.16), street * (0.66 + 0.13 * roadLines));

      float markerX = 0.22 + u_selected * 0.28;
      vec2 marker = vec2((uv.x - markerX) * aspect, uv.y - horizon - 0.035);
      float markerRadius = length(marker);
      float ring = 1.0 - smoothstep(0.003, 0.009, abs(markerRadius - 0.035));
      float markerDot = 1.0 - smoothstep(0.005, 0.012, markerRadius);
      color = mix(color, vec3(0.93), max(ring * 0.66, markerDot));

      float rain = 0.0;
      for (int i = 0; i < 18; i++) {
        float seed = float(i) * 17.0;
        float x = fract(hash(seed) + u_time * (0.012 + hash(seed + 1.0) * 0.024));
        float y = fract(hash(seed + 2.0) + u_time * (0.13 + hash(seed + 3.0) * 0.24));
        vec2 drop = vec2((uv.x - x) * aspect, uv.y - y);
        rain = max(rain, 1.0 - smoothstep(0.001, 0.003, abs(drop.x) + abs(drop.y * 0.22)));
      }
      color = mix(color, vec3(0.86), rain * 0.28);

      float vignette = 1.0 - smoothstep(0.25, 0.94, length((uv - 0.5) * vec2(aspect * 0.62, 1.0)));
      color *= 0.72 + 0.28 * vignette;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to allocate a WebGL shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error.';
      gl.deleteShader(shader);
      throw new Error(reason);
    }
    return shader;
  }

  function createRenderer() {
    if (!canvas) return null;
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: true,
      powerPreference: 'low-power',
    });

    if (!gl) {
      announce('WebGL is unavailable in this browser. The city view is shown as a static fallback.');
      canvas.classList.add('webgl-unavailable');
      return null;
    }

    try {
      const program = gl.createProgram();
      const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShader);
      const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
      if (!program) throw new Error('Unable to allocate the WebGL program.');
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const reason = gl.getProgramInfoLog(program) || 'Unknown WebGL program link error.';
        gl.deleteProgram(program);
        throw new Error(reason);
      }

      const vertices = gl.createBuffer();
      if (!vertices) throw new Error('Unable to allocate the WebGL scene buffer.');
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.useProgram(program);

      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      const uniforms = {
        resolution: gl.getUniformLocation(program, 'u_resolution'),
        pointer: gl.getUniformLocation(program, 'u_pointer'),
        time: gl.getUniformLocation(program, 'u_time'),
        selected: gl.getUniformLocation(program, 'u_selected'),
      };

      function resize() {
        const bounds = canvas.getBoundingClientRect();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(bounds.width * pixelRatio));
        const height = Math.max(1, Math.round(bounds.height * pixelRatio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          gl.viewport(0, 0, width, height);
        }
        return [width, height];
      }

      function draw(now) {
        const [width, height] = resize();
        gl.useProgram(program);
        gl.uniform2f(uniforms.resolution, width, height);
        gl.uniform2f(uniforms.pointer, pointerX, pointerY);
        gl.uniform1f(uniforms.time, paused ? 0 : (now - startTime) / 1000);
        gl.uniform1f(uniforms.selected, selectedLocation);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        cancelAnimationFrame(frameRequest);
        announce('The WebGL context was interrupted. Reload the page to restore the city view.');
      });

      return { draw };
    } catch (error) {
      console.error('Unable to initialize the WebGL city scene:', error);
      canvas.classList.add('webgl-unavailable');
      announce('The interactive city could not be initialized. Check the browser console for WebGL details.');
      return null;
    }
  }

  function render(now) {
    renderer?.draw(now);
    if (!paused && renderer) frameRequest = requestAnimationFrame(render);
  }

  function startRendering() {
    cancelAnimationFrame(frameRequest);
    if (paused || !renderer) {
      renderer?.draw(performance.now());
      return;
    }
    if (!startTime) startTime = performance.now();
    frameRequest = requestAnimationFrame(render);
  }

  function setPaused(nextPaused) {
    paused = nextPaused;
    root.dataset.motion = paused ? 'off' : 'on';
    motionToggle?.setAttribute('aria-pressed', String(paused));
    if (motionToggle) motionToggle.textContent = paused ? 'Resume city motion' : 'Pause city motion';
    startRendering();
  }

  renderer = createRenderer();
  if (renderer) {
    resizeObserver = new ResizeObserver(() => renderer.draw(performance.now()));
    resizeObserver.observe(canvas);
    canvas.addEventListener('pointermove', (event) => {
      const bounds = canvas.getBoundingClientRect();
      pointerX = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
      pointerY = 1 - Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
      if (paused) renderer.draw(performance.now());
    });
    startRendering();
  }

  motionToggle?.addEventListener('click', () => setPaused(!paused));
  reducedMotion.addEventListener('change', (event) => setPaused(event.matches));

  const navLinks = [...document.querySelectorAll('.site-nav a')];
  const sections = [...document.querySelectorAll('main section[id]')];
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          const current = link.getAttribute('href') === `#${entry.target.id}`;
          if (current) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    },
    { rootMargin: '-25% 0px -55% 0px' }
  );
  sections.forEach((section) => sectionObserver.observe(section));

  const records = {
    meridian: {
      kind: 'CASE FILE 01',
      title: 'Wibisono Meridian',
      copy: 'The first signed copy of the Meridian flood contract was entered into the archive six years after its listed signing date. The watermarks show it was already wet.',
    },
    shutdown: {
      kind: 'CASE FILE 02',
      title: 'Mysterious Shutdown..',
      copy: 'The Ninth Annex stopped answering its bell at 02:13. When the archive reopened, every file was still in place and warm to the touch.',
    },
    consulting: {
      kind: 'CASE FILE 03',
      title: 'M. Consulting',
      copy: 'M. Consulting has no registered office or employees. Its agreements are signed in ink that does not match any known hand.',
    },
    clara: {
      kind: 'PERSONNEL FOLDER',
      title: 'Clara Moss',
      copy: 'Archivist of the Ninth Annex. Clara safeguards the city’s missing obligations and recognizes a document that has been altered by hand.',
    },
    leo: {
      kind: 'PERSONNEL FOLDER',
      title: 'Leo Prasetyo',
      copy: 'Head of security. Leo handles sensitive movement across districts that no longer appear on city maps.',
    },
    mconsult: {
      kind: 'PERSONNEL FOLDER',
      title: 'M. Consulting',
      copy: 'Founder and sole operator of M. Consulting. M is known for discretion and the ability to close deals others cannot.',
    },
  };

  const dialog = document.querySelector('#record-dialog');
  const dialogTitle = document.querySelector('#dialog-title');
  const dialogKicker = document.querySelector('#dialog-kicker');
  const dialogCopy = document.querySelector('#dialog-copy');

  function openRecord(id, trigger) {
    const record = records[id];
    if (!record || !dialog || !dialogTitle || !dialogCopy || !dialogKicker) return;
    dialog.dataset.returnFocus = trigger?.getAttribute('aria-label') || trigger?.textContent.trim() || '';
    dialogTitle.textContent = record.title;
    dialogKicker.textContent = record.kind;
    dialogCopy.textContent = record.copy;
    dialog.showModal();
  }

  document.querySelectorAll('[data-case-open]').forEach((button) => {
    button.addEventListener('click', () => openRecord(button.dataset.caseOpen, button));
  });

  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog?.addEventListener('close', () => {
    const openerText = dialog.dataset.returnFocus;
    const opener = [...document.querySelectorAll('[data-case-open], [data-character-open]')].find(
      (button) => (button.getAttribute('aria-label') || button.textContent.trim()) === openerText
    );
    opener?.focus();
  });

  const worldSection = document.querySelector('.world-section');
  const worldBoard = document.querySelector('.world-board');
  const threadOne = document.querySelector('.thread-one');
  const threadTwo = document.querySelector('.thread-two');
  const meridianClip = document.querySelector('.case-meridian .world-clip');
  const shutdownClip = document.querySelector('.case-shutdown .world-clip');
  const consultingClip = document.querySelector('.case-consulting .world-clip');

  function positionWorldThreads() {
    if (!worldBoard || !threadOne || !threadTwo || !meridianClip || !shutdownClip || !consultingClip) return;

    const boardBounds = worldBoard.getBoundingClientRect();
    const points = {
      meridian: meridianClip.getBoundingClientRect(),
      shutdown: shutdownClip.getBoundingClientRect(),
      consulting: consultingClip.getBoundingClientRect(),
    };

    const center = (bounds) => ({
      x: bounds.left + bounds.width / 2 - boardBounds.left,
      y: bounds.top + bounds.height / 2 - boardBounds.top,
    });
    const meridian = center(points.meridian);
    const shutdown = center(points.shutdown);
    const consulting = center(points.consulting);

    const setThread = (thread, start, end) => {
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const length = Math.hypot(deltaX, deltaY);
      const angle = Math.atan2(deltaY, deltaX);
      thread.style.left = `${start.x}px`;
      thread.style.top = `${start.y}px`;
      thread.style.width = `${length}px`;
      thread.style.transform = `translateY(-50%) rotate(${angle}rad)`;
    };

    setThread(threadOne, meridian, shutdown);
    setThread(threadTwo, consulting, shutdown);
  }

  positionWorldThreads();
  window.addEventListener('resize', positionWorldThreads);

  document.querySelectorAll('.case-file').forEach((file) => {
    file.addEventListener('pointerenter', () => {
      worldSection?.classList.add('is-connecting');
      file.classList.add('is-selected');
      requestAnimationFrame(positionWorldThreads);
    });
    file.addEventListener('pointerleave', () => {
      worldSection?.classList.remove('is-connecting');
      file.classList.remove('is-selected');
      requestAnimationFrame(positionWorldThreads);
    });
    file.addEventListener('focusin', () => {
      worldSection?.classList.add('is-connecting');
      requestAnimationFrame(positionWorldThreads);
    });
    file.addEventListener('focusout', () => {
      worldSection?.classList.remove('is-connecting');
      requestAnimationFrame(positionWorldThreads);
    });
  });

  const folderStage = document.querySelector('.folder-stage');
  const charactersSection = document.querySelector('.characters-section');
  const desktopFolders = window.matchMedia('(min-width: 701px)');
  const folders = [...document.querySelectorAll('.folder')];
  let previousScrollY = window.scrollY;

  const updateFolderStackOffsets = () => {
    if (!folderStage || !desktopFolders.matches) return;
    const stackCenterX = folderStage.clientWidth / 2;
    const stackBaseY = 300;
    const stackConfig = [
      { selector: '.folder-clara', peekX: -16, peekY: 14, rot: -5 },
      { selector: '.folder-leo', peekX: 11, peekY: 7, rot: 3 },
      { selector: '.folder-mconsult', peekX: 0, peekY: 0, rot: 0 },
    ];

    stackConfig.forEach(({ selector, peekX, peekY, rot }) => {
      const folder = folderStage.querySelector(selector);
      if (!folder) return;
      const revealCenterX = folder.offsetLeft + folder.offsetWidth / 2;
      const revealY = folder.offsetTop;
      const stackX = stackCenterX + peekX - revealCenterX;
      const stackY = stackBaseY + peekY - revealY;
      folder.style.setProperty(
        '--folder-stack-transform',
        `translateX(${stackX}px) translateY(${stackY}px) rotate(${rot}deg)`,
      );
    });
  };

  const collapseFolders = () => {
    charactersSection?.classList.remove('is-revealed');
    folderStage?.removeAttribute('data-active-folder');
    document.querySelectorAll('.folder.is-selected').forEach((folder) => {
      folder.classList.remove('is-selected');
    });
  };

  if (charactersSection && 'IntersectionObserver' in window) {
    const folderObserver = new IntersectionObserver(
      ([entry]) => {
        charactersSection.classList.toggle('is-in-view', entry.isIntersecting);
        if (!entry.isIntersecting) {
          collapseFolders();
          return;
        }
        if (!desktopFolders.matches) charactersSection.classList.add('is-revealed');
      },
      { threshold: 0.2, rootMargin: '0px 0px -8% 0px' },
    );
    folderObserver.observe(charactersSection);
  } else {
    charactersSection?.classList.add('is-in-view');
    charactersSection?.classList.add('is-revealed');
  }

  updateFolderStackOffsets();
  window.addEventListener('resize', updateFolderStackOffsets);
  desktopFolders.addEventListener?.('change', updateFolderStackOffsets);

  window.addEventListener(
    'scroll',
    () => {
      const currentScrollY = window.scrollY;
      if (desktopFolders.matches && currentScrollY < previousScrollY) {
        collapseFolders();
      }
      previousScrollY = currentScrollY;
    },
    { passive: true },
  );

  folders.forEach((folder) => {
    const folderId = folder.querySelector('[data-character-open]')?.dataset.characterOpen;
    const activate = () => {
      if (charactersSection?.classList.contains('is-in-view') && desktopFolders.matches) {
        charactersSection.classList.add('is-revealed');
      }
      if (folderId) folderStage?.setAttribute('data-active-folder', folderId);
      folder.classList.add('is-selected');
    };
    const deactivate = () => {
      requestAnimationFrame(() => {
        if (folder.matches(':hover, :focus-within')) return;
        folder.classList.remove('is-selected');
        if (!folderStage?.querySelector('.folder.is-selected')) {
          folderStage?.removeAttribute('data-active-folder');
        }
      });
    };
    folder.addEventListener('pointerenter', activate);
    folder.addEventListener('pointerleave', deactivate);
    folder.addEventListener('focusin', activate);
    folder.addEventListener('focusout', (event) => {
      if (!folder.contains(event.relatedTarget)) deactivate();
    });
  });

  window.addEventListener(
    'pagehide',
    () => {
      cancelAnimationFrame(frameRequest);
      resizeObserver?.disconnect();
      sectionObserver.disconnect();
    },
    { once: true }
  );
})();
