// =========================================================
// 1. HELPER
// =========================================================
function parseInSARValue(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const cleaned = val.toString().trim().replace(',', '.');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
}

// Ambil nilai kolom tanpa peduli huruf besar/kecil dan spasi
function getField(row, names) {
    const keys = Object.keys(row);
    for (const n of names) {
        const k = keys.find(key => key.trim().toLowerCase() === n);
        if (k !== undefined) return row[k];
    }
    return undefined;
}

const getLat = row => parseInSARValue(getField(row, ['latitude', 'lat', 'y']));
const getLng = row => parseInSARValue(getField(row, ['longitude', 'lon', 'lng', 'long', 'x']));
const getVel = row => parseInSARValue(getField(row, ['velocity', 'vel', 'v']));

// Warna Marker berdasarkan Kecepatan (Velocity)
function getColor(velocity) {
    const v = parseInSARValue(velocity);
    return v > 10 ? '#b91c1c' :
           v > 5  ? '#ef4444' :
           v > 1  ? '#f97316' :
           v > 0  ? '#eab308' : '#22c55e';
}

// Ubah nama kolom tanggal (mis. "20170112" atau "d_20170112") ke tahun desimal
function dateKeyToDecimalYear(k) {
    const s = k.trim().replace(/^d_/i, '');
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(4, 6), 10) - 1;
    const d = parseInt(s.slice(6, 8), 10);
    const t = Date.UTC(y, m, d);
    const start = Date.UTC(y, 0, 1);
    const end = Date.UTC(y + 1, 0, 1);
    return y + (t - start) / (end - start);
}

// Regresi linear (least squares) + R²
function linearRegression(points) {
    const pts = points.filter(p => isFinite(p.x) && isFinite(p.y));
    const n = pts.length;
    if (n < 2) return null;

    const sx  = pts.reduce((a, p) => a + p.x, 0);
    const sy  = pts.reduce((a, p) => a + p.y, 0);
    const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
    const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);

    const denom = n * sxx - sx * sx;
    if (denom === 0) return null;

    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;

    const meanY = sy / n;
    const ssTot = pts.reduce((a, p) => a + (p.y - meanY) ** 2, 0);
    const ssRes = pts.reduce((a, p) => a + (p.y - (slope * p.x + intercept)) ** 2, 0);
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

    return { slope, intercept, r2 };
}

let rawCSVData = [];
let pointIndex = [];
let selectedMarker = null;
// =========================================================
// 2. INISIALISASI PETA & BASEMAP
// =========================================================
const map = L.map('map').setView([-7.7866348, 110.1791552], 12);

// Buat custom pane untuk basemap agar posisinya selalu di bawah layer TIF
map.createPane('basemapPane');
map.getPane('basemapPane').style.zIndex = 200; // Default tilePane adalah 200

const basemaps = {
    'carto-light': L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        maxZoom: 19,
        pane: 'basemapPane', // Tambahkan opsi pane di sini
        attribution: '&copy; OpenStreetMap contributors'
    }),
    'satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        pane: 'basemapPane', // Tambahkan opsi pane di sini
        attribution: 'Tiles &copy; Esri'
    }),
    'osm': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        pane: 'basemapPane', // Tambahkan opsi pane di sini
        attribution: '&copy; OpenStreetMap contributors'
    })
};

basemaps['carto-light'].addTo(map);

const basemapSelect = document.getElementById('basemap-select');
if (basemapSelect) {
    basemapSelect.addEventListener('change', (e) => {
        Object.values(basemaps).forEach(layer => map.removeLayer(layer));
        if (basemaps[e.target.value]) {
            basemaps[e.target.value].addTo(map);
        }
    });
}

// =========================================================
// 3. GRAFIK 1 (LINE CHART)
// =========================================================
const ctx1 = document.getElementById('timeSeriesChart')?.getContext('2d');
let timeSeriesChart = null;

if (ctx1) {
    timeSeriesChart = new Chart(ctx1, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Deformasi (mm)',
                data: [],
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                pointRadius: 3,
                pointBackgroundColor: '#ef4444'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top' } },
            scales: {
                x: { title: { display: true, text: 'Tanggal' } },
                y: { title: { display: true, text: 'Displacement (mm)' } }
            }
        }
    });
}

// =========================================================
// 4. GRAFIK 2 (SCATTER PLOT + REGRESI LINEAR)
// =========================================================
const ctx2 = document.getElementById('scatterChart')?.getContext('2d');
let scatterChart = null;

if (ctx2) {
    scatterChart = new Chart(ctx2, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'LOS displacement [mm]',
                    data: [],
                    backgroundColor: '#0891b2',
                    borderColor: '#0e7490',
                    pointRadius: 3,
                    showLine: false
                },
                {
                    label: 'Regresi linear',
                    data: [],
                    type: 'line',
                    borderColor: '#ef4444',
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 10 } } }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Tahun' },
                    grid: { display: true, color: '#f3f4f6' },
                    ticks: { callback: v => Number(v).toFixed(1) }
                },
                y: {
                    title: { display: true, text: 'LOS displacement [mm]' },
                    grid: { display: true, color: '#e5e7eb' }
                }
            }
        }
    });
}

// =========================================================
// 5. UPDATE PANEL & GRAFIK SAAT TITIK DIPILIH
// =========================================================
function updateDashboardSelection(row) {
    if (!row) return;

    const pointIdRaw = getField(row, ['point_id', 'id']);
    const pixelRaw = getField(row, ['pixel']);
    const pointId = pointIdRaw || (pixelRaw !== undefined ? `Pixel ${pixelRaw}` : '-');
    const kecamatan = getField(row, ['kecamatan']) || '-';
    const velocityVal = getVel(row);
    const lat = getLat(row).toFixed(5);
    const lng = getLng(row).toFixed(5);

    const floatingCard = document.getElementById('floating-card');
    if (floatingCard) floatingCard.classList.remove('hidden');

    const elemPointId = document.getElementById('point-id');
    const elemKecamatan = document.getElementById('point-kecamatan');
    const elemVelocity = document.getElementById('point-velocity');
    const elemCoords = document.getElementById('point-coords');

    if (elemPointId) elemPointId.innerText = `Point: ${pointId}`;
    if (elemKecamatan) elemKecamatan.innerText = kecamatan;
    if (elemVelocity) elemVelocity.innerText = `${velocityVal} mm/tahun`;
    if (elemCoords) elemCoords.innerText = `${lat}, ${lng}`;

    // Kolom time series: "d_20170103" atau "20170103"
    const timeKeys = Object.keys(row)
        .filter(k => /^d_\d{8}$/i.test(k.trim()) || /^\d{8}$/.test(k.trim()))
        .sort();

    // Grafik 1: line chart
    if (timeSeriesChart) {
        timeSeriesChart.data.labels = timeKeys.map(k => k.trim().replace(/^d_/i, ''));
        timeSeriesChart.data.datasets[0].data = timeKeys.map(k => parseInSARValue(row[k]));
        timeSeriesChart.data.datasets[0].label = `Deformasi ${pointId} (mm)`;
        timeSeriesChart.update();
    }

    // Grafik 2: scatter + regresi
    if (scatterChart) {
        const scatterPoints = timeKeys
            .filter(k => {
                const raw = row[k];
                return raw !== undefined && raw !== null && String(raw).trim() !== '';
            })
            .map(k => ({
                x: dateKeyToDecimalYear(k),
                y: parseInSARValue(row[k])
            }));

        scatterChart.data.datasets[0].data = scatterPoints;

        const reg = linearRegression(scatterPoints);
        if (reg) {
            const xs = scatterPoints.map(p => p.x);
            const x0 = Math.min(...xs);
            const x1 = Math.max(...xs);
            scatterChart.data.datasets[1].data = [
                { x: x0, y: reg.slope * x0 + reg.intercept },
                { x: x1, y: reg.slope * x1 + reg.intercept }
            ];
            scatterChart.data.datasets[1].label =
                `Regresi: ${reg.slope.toFixed(2)} mm/thn (R² = ${reg.r2.toFixed(2)})`;
        } else {
            scatterChart.data.datasets[1].data = [];
            scatterChart.data.datasets[1].label = 'Regresi linear';
        }

        scatterChart.update();
    }
}

// =========================================================
// 6. INDEX TITIK (TIDAK DIGAMBAR, HANYA UNTUK KLIK)
// =========================================================
function renderDashboardData(data) {
    const totalPointsElem = document.getElementById('total-points');
    const avgVelocityElem = document.getElementById('avg-velocity');

    if (totalPointsElem) totalPointsElem.innerText = data.length;
    if (avgVelocityElem && data.length > 0) {
        const avgVel = data.reduce((acc, cur) => acc + getVel(cur), 0) / data.length;
        avgVelocityElem.innerText = `${avgVel.toFixed(1)} mm/thn`;
    }

    pointIndex = [];
    const bounds = L.latLngBounds();

    data.forEach(row => {
        const lat = getLat(row);
        const lng = getLng(row);
        if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return;
        pointIndex.push({ lat, lng, row });
        bounds.extend([lat, lng]);
    });

    console.log(`Titik valid: ${pointIndex.length} dari ${data.length} baris`);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] });
}

// =========================================================
// 7. KLIK PETA -> CARI TITIK TERDEKAT
// =========================================================
const MAX_CLICK_DIST_PX = 25;   // jarak maksimum klik ke titik terdekat (piksel layar)

map.on('click', function (e) {
    if (pointIndex.length === 0) return;

    const clickPt = map.latLngToContainerPoint(e.latlng);
    let best = null, bestDist = Infinity;

    for (const p of pointIndex) {
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        const d = Math.hypot(pt.x - clickPt.x, pt.y - clickPt.y);
        if (d < bestDist) { bestDist = d; best = p; }
    }

    if (!best || bestDist > MAX_CLICK_DIST_PX) return;   // klik di luar area data

    // Penanda sementara supaya terlihat titik mana yang dipilih
    if (selectedMarker) map.removeLayer(selectedMarker);
    selectedMarker = L.circleMarker([best.lat, best.lng], {
        radius: 6, color: '#000', weight: 2, fillOpacity: 0, interactive: false
    }).addTo(map);

    updateDashboardSelection(best.row);
});

// =========================================================
// 8. SORTING
// =========================================================
function getSortedData(data, sortOrder) {
    const dataCopy = [...data];
    if (sortOrder === 'asc') {
        return dataCopy.sort((a, b) => getVel(a) - getVel(b));
    } else if (sortOrder === 'desc') {
        return dataCopy.sort((a, b) => getVel(b) - getVel(a));
    }
    return dataCopy;
}

const sortSelect = document.getElementById('sort-select');
if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
        const sortedData = getSortedData(rawCSVData, e.target.value);
        renderDashboardData(sortedData);
        if (sortedData.length > 0) {
            updateDashboardSelection(sortedData[0]);
        }
    });
}

// =========================================================
// 9. BACA CSV DENGAN PAPAPARSE
// =========================================================
Papa.parse('data/dsc_timeseries.csv', {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: function (results) {
        rawCSVData = results.data;

        console.log('Jumlah baris:', rawCSVData.length);
        if (rawCSVData.length > 0) {
            console.log('Nama kolom:', Object.keys(rawCSVData[0]));
            console.log('Baris pertama:', rawCSVData[0]);
        }
        if (results.errors.length) console.warn('Parse errors:', results.errors);

        const currentSort = sortSelect ? sortSelect.value : 'none';
        const displayData = getSortedData(rawCSVData, currentSort);

        renderDashboardData(displayData);

        // Hapus blok ini kalau tidak ingin panel terbuka otomatis saat halaman dimuat
        if (displayData.length > 0) {
            updateDashboardSelection(displayData[0]);
        }
    },
    error: function (err) {
        console.error('❌ Error membaca CSV:', err);
    }
});

// =========================================================
// 10. KONTROL INTERAKSI
// =========================================================
const closeCardBtn = document.getElementById('close-card');
if (closeCardBtn) {
    closeCardBtn.addEventListener('click', () => {
        document.getElementById('floating-card')?.classList.add('hidden');
    });
}

const toggleControlBtn = document.getElementById('toggle-control-btn');
const controlBody = document.getElementById('control-body');
if (toggleControlBtn && controlBody) {
    toggleControlBtn.addEventListener('click', () => {
        if (controlBody.style.display === 'none') {
            controlBody.style.display = 'block';
            toggleControlBtn.innerHTML = '&minus;';
        } else {
            controlBody.style.display = 'none';
            toggleControlBtn.innerHTML = '&#43;';
        }
    });
}


// =========================================================
// 11. LAYER RASTER TIF VELOCITY
// =========================================================
const COLOR_STOPS = [
    [-10,   [185, 28, 28]],   // turun cepat: merah tua
    [ -7,   [239, 68, 68]],   // merah
    [ -4,   [249, 115, 22]],  // oranye
    [ -1.5, [234, 179, 8]],   // kuning
    [  0,   [34, 197, 94]],   // hijau (stabil)
    [  3,   [59, 130, 246]]   // biru (naik)
];

function velocityToColor(v) {
    if (v <= COLOR_STOPS[0][0]) return `rgb(${COLOR_STOPS[0][1].join(',')})`;
    const last = COLOR_STOPS[COLOR_STOPS.length - 1];
    if (v >= last[0]) return `rgb(${last[1].join(',')})`;

    for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
        const [v0, c0] = COLOR_STOPS[i];
        const [v1, c1] = COLOR_STOPS[i + 1];
        if (v >= v0 && v <= v1) {
            const t = (v - v0) / (v1 - v0);
            const rgb = c0.map((c, k) => Math.round(c + (c1[k] - c) * t));
            return `rgb(${rgb.join(',')})`;
        }
    }
    return null;
}

// Buat custom pane khusus untuk TIF dengan zIndex di atas basemap (zIndex 200)
if (!map.getPane('tifPane')) {
    map.createPane('tifPane');
    map.getPane('tifPane').style.zIndex = 300;
}

fetch('data/vel.tif')
    .then(r => {
        if (!r.ok) throw new Error('TIF tidak ditemukan: HTTP ' + r.status);
        return r.arrayBuffer();
    })
    .then(buf => parseGeoraster(buf))
    .then(georaster => {
        console.log('Georaster:', {
            projection: georaster.projection,
            size: [georaster.width, georaster.height],
            bounds: [georaster.xmin, georaster.ymin, georaster.xmax, georaster.ymax],
            nodata: georaster.noDataValue,
            min: georaster.mins[0],
            max: georaster.maxs[0]
        });

        const tifLayer = new GeoRasterLayer({
            georaster,
            opacity: 0.7,
            resolution: 256,
            pane: 'tifPane', // <-- Menyimpan layer TIF di pane khusus zIndex 300
            pixelValuesToColorFn: values => {
                const v = values[0];
                if (v === undefined || v === null || !isFinite(v)) return null;
                if (georaster.noDataValue !== undefined && v === georaster.noDataValue) return null;
                return velocityToColor(v);
            }
        });

        tifLayer.addTo(map);
        tifLayer.getContainer?.()?.style && (tifLayer.getContainer().style.pointerEvents = 'none');
map.getPane('tifPane').style.pointerEvents = 'none';
        console.log('TIF layer ditambahkan pada tifPane');
    })
    .catch(err => console.error('Gagal memuat TIF:', err));


// =========================================================
// 12. LAYER BATAS DESA (GEOJSON)
// =========================================================
const desaStyle = {
    color: '#1e293b',
    weight: 1.2,
    fillOpacity: 0          // tanpa isi, supaya raster tetap terlihat
};

fetch('data/admin_desa.geojson')
    .then(r => {
        if (!r.ok) throw new Error('GeoJSON tidak ditemukan: HTTP ' + r.status);
        return r.json();
    })
    .then(geojson => {
        const desaLayer = L.geoJSON(geojson, {
            style: desaStyle,
            interactive: false, // <-- MATIKAN INTERAKSI DI SINI
            /*
               Catatan: Efek hover (desaHover) dan Tooltip tidak akan berjalan 
               karena interaksi pointer sudah dimatikan total.
            */
        }).addTo(map);

        console.log('Batas desa ditambahkan:', geojson.features.length, 'fitur');
        console.log('Atribut contoh:', geojson.features[0]?.properties);
    })
    .catch(err => console.error('Gagal memuat GeoJSON:', err));

// =========================================================
// EVENT LISTENER ZOOM KECAMATAN (TANPA FILTER)
// =========================================================
const kecamatanSelect = document.getElementById('kecamatan-select');
console.log('kecamatan-select ditemukan?', !!kecamatanSelect);

const normKec = s => (s || '').toString().toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/^kecamatan\s+/, '')
    .replace(/[^a-z0-9]/g, '');

if (kecamatanSelect) {
    kecamatanSelect.addEventListener('change', (e) => {
        const selectedKec = e.target.value;
        const isAll = !selectedKec || selectedKec === 'all' || selectedKec === 'Semua Kecamatan';
        const target = normKec(selectedKec);

        const bounds = L.latLngBounds();
        let n = 0;
        rawCSVData.forEach(row => {
            if (!isAll && normKec(getField(row, ['kecamatan'])) !== target) return;
            const lat = getLat(row), lng = getLng(row);
            if (isFinite(lat) && isFinite(lng) && (lat !== 0 || lng !== 0)) {
                bounds.extend([lat, lng]);
                n++;
            }
        });

        console.log('Dipilih:', JSON.stringify(selectedKec), '| titik cocok:', n);
        if (n === 0) {
            console.log('Contoh nilai kecamatan di CSV:',
                [...new Set(rawCSVData.map(r => getField(r, ['kecamatan'])))].slice(0, 15));
        }

        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
    });
}