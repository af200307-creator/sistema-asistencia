/**
 * ============================================================================
 * SISTEMA EMPRESARIAL DE CONTROL DE ASISTENCIA ESCOLAR QR - LÓGICA PROFESOR
 * Archivo: escanear.js
 * ============================================================================
 */

let html5QrCode = null;
let camarasDisponibles = [];
let indiceCamaraActual = 0;
let camaraPausada = false;
let linternaEncendida = false;
let vozActiva = true;
let bloqueoEscaneoTemporal = false;

let alumnosPadron = [];
let asistenciasHoyLista = [];

document.addEventListener("DOMContentLoaded", () => {
  inicializarTema();
  iniciarRelojYEstadoHorario();

  // 1. Escuchar Configuración del Colegio en Vivo
  escucharConfiguracion((cfg) => {
    document.querySelectorAll(".js-school-name").forEach((el) => (el.textContent = cfg.nombre));
    document.querySelectorAll(".js-school-logo").forEach((img) => (img.src = cfg.logo || DEFAULT_LOGO_BASE64));
    const fav = document.getElementById("dynamicFavicon");
    if (fav) fav.href = cfg.logo || "logo.jpeg";
    actualizarInsigniaHorario();
  });

  // 2. Escuchar los 30 Alumnos de Primaria desde Firestore
  escucharAlumnos((lista) => {
    alumnosPadron = lista;
    poblarSelectorManual();
    actualizarResumenYProgreso();
  });

  // 3. Escuchar Asistencias del Día en Tiempo Real
  escucharAsistenciasHoy();

  // 4. Iniciar Cámara Lectora QR
  inicializarLectorQR();
});

// ============================================================================
// RELOJ EN VIVO E INSIGNIA DINÁMICA ("Horario Puntual" / "Horario de Tardanza")
// ============================================================================
function iniciarRelojYEstadoHorario() {
  const clockEl = document.getElementById("mobileClock");
  const tick = () => {
    const ahora = new Date();
    if (clockEl) clockEl.textContent = obtenerHoraActualLegible(ahora);
    actualizarInsigniaHorario(ahora);
  };
  tick();
  setInterval(tick, 1000);
}

function actualizarInsigniaHorario(ahora = new Date()) {
  const badge = document.getElementById("badgeHorarioDinamico");
  if (!badge) return;

  const estadoActual = evaluarEstadoHorario(ahora, window.CONFIG_COLEGIO);
  const lim = window.CONFIG_COLEGIO?.horaLimite || "08:00";
  const tol = window.CONFIG_COLEGIO?.tolerancia ?? 10;

  if (estadoActual === "PUNTUAL") {
    badge.className = "schedule-dynamic-badge badge-puntual";
    badge.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>Horario Puntual (Lím: ${lim} +${tol}m)</span>`;
  } else {
    badge.className = "schedule-dynamic-badge badge-tardanza";
    badge.innerHTML = `<i class="fa-solid fa-clock"></i> <span>Horario de Tardanza (Lím: ${lim})</span>`;
  }
}

// ============================================================================
// ESCUCHA EN TIEMPO REAL DE LAS ASISTENCIAS DE HOY
// ============================================================================
function escucharAsistenciasHoy() {
  db.collection("asistencias")
    .orderBy("timestamp", "desc")
    .onSnapshot((snapshot) => {
      const hoyISO = obtenerFechaHoyISO();
      const listaHoy = [];

      snapshot.forEach((doc) => {
        const d = doc.data();
        const fechaISO = d.fechaISO || obtenerFechaHoyISO();
        if (fechaISO === hoyISO) {
          const codigo = d.codigo || extraerCodigoQR(d.alumno) || "PRI-000";
          const alumnoRef = alumnosPadron.find((a) => a.codigo === codigo);
          listaHoy.push({
            id: doc.id,
            codigo,
            nombre: d.nombre || (alumnoRef ? alumnoRef.nombre : (d.alumno || "Estudiante")),
            grado: d.grado || (alumnoRef ? alumnoRef.grado : "Primaria"),
            hora: d.hora || "--:--:--",
            estado: (d.estado || "PUNTUAL").toUpperCase()
          });
        }
      });

      asistenciasHoyLista = listaHoy;
      actualizarResumenYProgreso();
      poblarSelectorManual();
      renderizarUltimosCincoEscaneos();
    });
}

function actualizarResumenYProgreso() {
  const totalMatriculados = alumnosPadron.length || 30;
  const unicos = new Map();
  asistenciasHoyLista.forEach((r) => {
    if (!unicos.has(r.codigo)) unicos.set(r.codigo, r);
  });

  let puntuales = 0;
  let tardanzas = 0;
  unicos.forEach((r) => {
    if (r.estado === "TARDANZA") tardanzas++;
    else puntuales++;
  });

  const presentes = unicos.size;
  const faltan = Math.max(0, totalMatriculados - presentes);
  const porcentaje = totalMatriculados > 0 ? Math.round((presentes / totalMatriculados) * 100) : 0;

  document.getElementById("pillPuntuales").textContent = puntuales;
  document.getElementById("pillTardanzas").textContent = tardanzas;
  document.getElementById("pillFaltan").textContent = faltan;

  document.getElementById("textoProgresoDia").textContent = `${porcentaje}% (${presentes}/${totalMatriculados})`;
  document.getElementById("barraProgresoDia").style.width = `${porcentaje}%`;
}

function poblarSelectorManual() {
  const select = document.getElementById("selectAlumnoManual");
  if (!select) return;

  const valorPrevio = select.value;
  const codigosPresentes = new Set(asistenciasHoyLista.map((r) => r.codigo));

  select.innerHTML = `<option value="">Seleccionar alumno (${alumnosPadron.length} matriculados)...</option>` +
    alumnosPadron.map((al) => {
      const yaIngreso = codigosPresentes.has(al.codigo);
      const etiquetaEstado = yaIngreso ? "✓ [YA REGISTRADO]" : "";
      return `<option value="${al.codigo}">${al.codigo} - ${al.nombre} (${al.grado}) ${etiquetaEstado}</option>`;
    }).join("");

  if (valorPrevio) select.value = valorPrevio;
}

function renderizarUltimosCincoEscaneos() {
  const contenedor = document.getElementById("listaRecientesMobile");
  if (!contenedor) return;

  const ultimos5 = asistenciasHoyLista.slice(0, 5);
  if (ultimos5.length === 0) {
    contenedor.innerHTML = `
      <div style="text-align:center; padding:18px; color:var(--text-secondary); font-size:0.84rem;">
        Aún no hay alumnos escaneados el día de hoy.
      </div>
    `;
    return;
  }

  contenedor.innerHTML = ultimos5.map((item) => {
    const claseBadge = item.estado === "TARDANZA" ? "badge-tardanza" : (item.estado === "JUSTIFICADO" ? "badge-justificado" : "badge-puntual");
    return `
      <div class="recent-scan-item">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          <div class="avatar-circle" style="background:${obtenerColorAvatar(item.codigo)}; width:36px; height:36px; font-size:0.8rem;">
            ${obtenerIniciales(item.nombre)}
          </div>
          <div style="min-width:0;">
            <div style="font-weight:700; font-size:0.85rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${item.nombre}
            </div>
            <div style="font-size:0.73rem; color:var(--text-secondary);">
              ${item.codigo} • ${item.grado} • <strong>${item.hora}</strong>
            </div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
          <span class="badge-status ${claseBadge}" style="font-size:0.68rem; padding:3px 8px;">${item.estado}</span>
          <button
            type="button"
            class="btn btn-danger btn-sm"
            style="padding:5px 8px;"
            onclick="anularEscaneoReciente('${item.id}', '${item.nombre.replace(/'/g, "\\'")}')"
            title="Anular este registro"
          >
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================================================
// CÁMARA QR (html5-qrcode) Y CONTROLES AVANZADOS
// ============================================================================
async function inicializarLectorQR() {
  if (typeof Html5Qrcode === "undefined") return;
  html5QrCode = new Html5Qrcode("reader");

  try {
    camarasDisponibles = await Html5Qrcode.getCameras();
    if (camarasDisponibles && camarasDisponibles.length > 0) {
      // Priorizar cámara trasera si existe
      const idxTrasera = camarasDisponibles.findIndex((c) => /back|trasera|environment/i.test(c.label));
      indiceCamaraActual = idxTrasera >= 0 ? idxTrasera : 0;
      await iniciarStreamCamara(camarasDisponibles[indiceCamaraActual].id);
    } else {
      await iniciarStreamCamara({ facingMode: "environment" });
    }
  } catch (err) {
    console.warn("No se pudo acceder a la cámara inicialmente:", err);
    mostrarToast("Cámara en espera", "Permite el acceso a la cámara o utiliza el selector manual.", "warning");
  }
}

async function iniciarStreamCamara(cameraIdOrConfig) {
  if (!html5QrCode) return;
  try {
    if (html5QrCode.isScanning) {
      await html5QrCode.stop();
    }
    await html5QrCode.start(
      cameraIdOrConfig,
      {
        fps: 12,
        qrbox: { width: 220, height: 220 },
        aspectRatio: 1.0
      },
      onScanSuccess
    );
    camaraPausada = false;
    actualizarUIPausa();
  } catch (err) {
    console.warn("Error iniciando stream QR:", err);
  }
}

async function cambiarCamara() {
  if (!camarasDisponibles || camarasDisponibles.length < 2) {
    mostrarToast("Cámara Única", "Solo se detectó una cámara en este dispositivo.", "info");
    return;
  }
  indiceCamaraActual = (indiceCamaraActual + 1) % camarasDisponibles.length;
  linternaEncendida = false;
  document.getElementById("btnFlash")?.classList.remove("active");
  await iniciarStreamCamara(camarasDisponibles[indiceCamaraActual].id);
  mostrarToast("Cámara Cambiada", camarasDisponibles[indiceCamaraActual].label || `Cámara ${indiceCamaraActual + 1}`, "info");
}

async function alternarLinterna() {
  if (!html5QrCode || !html5QrCode.isScanning) return;
  try {
    linternaEncendida = !linternaEncendida;
    await html5QrCode.applyVideoConstraints({
      advanced: [{ torch: linternaEncendida }]
    });
    document.getElementById("btnFlash")?.classList.toggle("active", linternaEncendida);
  } catch (err) {
    linternaEncendida = false;
    document.getElementById("btnFlash")?.classList.remove("active");
    mostrarToast("Linterna no soportada", "Este lente o navegador no dispone de flash LED.", "warning");
  }
}

function alternarPausaCamara() {
  if (!html5QrCode || !html5QrCode.isScanning) return;
  try {
    if (!camaraPausada) {
      html5QrCode.pause(true);
      camaraPausada = true;
    } else {
      html5QrCode.resume();
      camaraPausada = false;
    }
    actualizarUIPausa();
  } catch (e) {
    console.warn("No se pudo alternar pausa:", e);
  }
}

function actualizarUIPausa() {
  const btn = document.getElementById("btnPauseCam");
  const txt = document.getElementById("txtPauseCam");
  const laser = document.getElementById("laserLine");
  if (!btn || !txt) return;

  if (camaraPausada) {
    btn.classList.add("active");
    btn.querySelector("i").className = "fa-solid fa-play";
    txt.textContent = "Reanudar";
    if (laser) laser.style.display = "none";
  } else {
    btn.classList.remove("active");
    btn.querySelector("i").className = "fa-solid fa-pause";
    txt.textContent = "Pausar";
    if (laser) laser.style.display = "block";
  }
}

function alternarVoz() {
  vozActiva = !vozActiva;
  const btn = document.getElementById("btnToggleVoice");
  const icon = document.getElementById("iconVoice");
  const txt = document.getElementById("txtVoice");

  if (btn) btn.classList.toggle("active", vozActiva);
  if (icon) icon.className = vozActiva ? "fa-solid fa-volume-high" : "fa-solid fa-volume-xmark";
  if (txt) txt.textContent = vozActiva ? "Voz ON" : "Voz OFF";
}

// ============================================================================
// PROCESAMIENTO DE ESCANEO, ANTI-DUPLICADOS, VOZ Y ANIMACIÓN SVG
// ============================================================================
function extraerCodigoQR(texto = "") {
  const limpio = String(texto).trim().toUpperCase();
  const match = limpio.match(/PRI-\d{3}/i);
  return match ? match[0].toUpperCase() : limpio;
}

function onScanSuccess(decodedText) {
  if (bloqueoEscaneoTemporal) return;
  procesarIngresoAlumno(decodedText, true);
}

function registrarDesdeSelectorManual() {
  const select = document.getElementById("selectAlumnoManual");
  if (!select || !select.value) {
    mostrarToast("Selecciona un alumno", "Elige un estudiante de la lista desplegable.", "warning");
    return;
  }
  procesarIngresoAlumno(select.value, false);
  select.value = "";
}

async function procesarIngresoAlumno(textoEntrada, desdeCamara = true) {
  if (bloqueoEscaneoTemporal) return;
  bloqueoEscaneoTemporal = true;

  // Pausar escáner por 2 segundos si vino desde la cámara
  if (desdeCamara && html5QrCode && html5QrCode.isScanning && !camaraPausada) {
    try {
      html5QrCode.pause(true);
    } catch (e) {}
  }

  const codigoDetectado = extraerCodigoQR(textoEntrada);
  let alumno = alumnosPadron.find(
    (a) => a.codigo.toUpperCase() === codigoDetectado || a.nombre.toUpperCase() === String(textoEntrada).trim().toUpperCase()
  );

  // Si es un código QR nuevo no listado en el padrón, crear objeto temporal
  if (!alumno) {
    alumno = {
      codigo: codigoDetectado.startsWith("PRI-") ? codigoDetectado : "PRI-EXT",
      nombre: String(textoEntrada).trim(),
      grado: "Primaria",
      telefono: "51987654301"
    };
  }

  // VERIFICACIÓN ANTI-DUPLICADOS INTELIGENTE
  const registroExistenteHoy = asistenciasHoyLista.find((r) => r.codigo === alumno.codigo);

  if (registroExistenteHoy) {
    AudioFX.beepDuplicado();
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
    VozFX.hablar("Alumno ya registrado", vozActiva);

    mostrarModalFeedback({
      tipo: "DUPLICADO",
      nombre: alumno.nombre,
      grado: `${alumno.grado} • ${alumno.codigo}`,
      estado: "YA REGISTRADO HOY",
      hora: `Ingresó a las ${registroExistenteHoy.hora}`
    });

    finalizarPausaTemporal(desdeCamara);
    return;
  }

  // REGISTRAR NUEVA ASISTENCIA EN FIREBASE
  const ahora = new Date();
  const hoyISO = obtenerFechaHoyISO();
  const fechaLegible = formatearFechaISOaLegible(hoyISO);
  const horaLegible = obtenerHoraActualLegible(ahora);
  const estado = evaluarEstadoHorario(ahora, window.CONFIG_COLEGIO);

  try {
    await db.collection("asistencias").add({
      codigo: alumno.codigo,
      nombre: alumno.nombre,
      alumno: `${alumno.codigo} - ${alumno.nombre}`,
      grado: alumno.grado,
      telefono: alumno.telefono || "51987654301",
      fechaISO: hoyISO,
      fecha: fechaLegible,
      hora: horaLegible,
      estado: estado,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    if (estado === "PUNTUAL") {
      AudioFX.beepExito();
      VozFX.hablar(`Bienvenido, ${alumno.nombre}`, vozActiva);
    } else {
      AudioFX.beepTardanza();
      VozFX.hablar(`Tardanza registrada, ${alumno.nombre}`, vozActiva);
    }

    if (navigator.vibrate) navigator.vibrate(200);

    mostrarModalFeedback({
      tipo: "EXITO",
      nombre: alumno.nombre,
      grado: `${alumno.grado} • ${alumno.codigo}`,
      estado: estado,
      hora: `Hora exacta: ${horaLegible}`
    });
  } catch (err) {
    console.error("Error guardando asistencia:", err);
    mostrarToast("Error de Red", "No se pudo guardar la asistencia en Firebase.", "error");
  }

  finalizarPausaTemporal(desdeCamara);
}

function finalizarPausaTemporal(desdeCamara) {
  setTimeout(() => {
    cerrarModalFeedback();
    if (desdeCamara && html5QrCode && !camaraPausada) {
      try {
        html5QrCode.resume();
      } catch (e) {}
    }
    bloqueoEscaneoTemporal = false;
  }, 2000);
}

// ============================================================================
// MODAL FLOTANTE CON ANIMACIÓN SVG (CHECK VERDE ✔️ Y ADVERTENCIA ⚠️)
// ============================================================================
function mostrarModalFeedback({ tipo, nombre, grado, estado, hora }) {
  const modal = document.getElementById("modalResultadoScan");
  const svgBox = document.getElementById("modalSvgContainer");
  const badgeBox = document.getElementById("modalBadgeEstado");
  const tituloEl = document.getElementById("modalTituloAlumno");
  const subEl = document.getElementById("modalSubtituloGrado");
  const horaEl = document.getElementById("modalHoraIngreso");

  if (tipo === "DUPLICADO") {
    svgBox.innerHTML = `
      <svg viewBox="0 0 100 100" width="88" height="88">
        <circle class="svg-circle" cx="50" cy="50" r="42" fill="rgba(245,158,11,0.12)" stroke="#f59e0b" stroke-width="6" />
        <path class="svg-path" d="M50 30 L50 58" fill="none" stroke="#f59e0b" stroke-width="7" stroke-linecap="round" />
        <circle cx="50" cy="72" r="4.5" fill="#f59e0b" />
      </svg>
    `;
    badgeBox.innerHTML = `<span class="badge-status badge-ausente">⚠️ ALUMNO YA REGISTRADO</span>`;
  } else {
    const colorStroke = estado === "TARDANZA" ? "#ef4444" : "#10b981";
    const colorFill = estado === "TARDANZA" ? "rgba(239,68,68,0.12)" : "rgba(16,185,129,0.12)";
    const claseBadge = estado === "TARDANZA" ? "badge-tardanza" : "badge-puntual";

    svgBox.innerHTML = `
      <svg viewBox="0 0 100 100" width="88" height="88">
        <circle class="svg-circle" cx="50" cy="50" r="42" fill="${colorFill}" stroke="${colorStroke}" stroke-width="6" />
        <path class="svg-path" d="M30 52 L44 66 L72 36" fill="none" stroke="${colorStroke}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
    badgeBox.innerHTML = `<span class="badge-status ${claseBadge}">✔️ ${estado}</span>`;
  }

  tituloEl.textContent = nombre;
  subEl.textContent = grado;
  horaEl.textContent = hora;

  modal.classList.add("show");
}

function cerrarModalFeedback() {
  const modal = document.getElementById("modalResultadoScan");
  if (modal) modal.classList.remove("show");
}

// ============================================================================
// ANULAR ESCANEO RECIENTE (BOTÓN PAPELERA 🗑️)
// ============================================================================
async function anularEscaneoReciente(docId, nombre) {
  if (!confirm(`¿Anular el registro de asistencia de ${nombre}?`)) return;
  try {
    await db.collection("asistencias").doc(docId).delete();
    mostrarToast("Registro Anulado", `Se eliminó la asistencia de ${nombre}.`, "warning");
  } catch (err) {
    console.error("Error anulando asistencia:", err);
    mostrarToast("Error", "No se pudo anular el registro en Firebase.", "error");
  }
}
