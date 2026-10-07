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

// =========================================================
// 2. INISIALISASI PETA & BASEMAP
// =========================================================
const map = L.map('map').setView([-7.7866348, 110.1791552], 12);

const basemaps = {
    'carto-light': L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }),
    'satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri'
    }),
    'osm': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
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

// Variabel global
let rawCSVData = [];
let markerLayerGroup = L.layerGroup();

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
// 4. GRAFIK 2 (SCATTER PLOT)
// =========================================================
const ctx2 = document.getElementById('scatterChart')?.getContext('2d');
let scatterChart = null;

if (ctx2) {
    scatterChart = new Chart(ctx2, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'LOS displacement [cm]',
                data: [],
                backgroundColor: '#0891b2',
                borderColor: '#0e7490',
                pointRadius: 3,
                showLine: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Akuisisi Waktu (Index)' },
                    grid: { display: true, color: '#f3f4f6' }
                },
                y: {
                    title: { display: true, text: 'LOS displacement [cm]' },
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

    // Kolom time series: "d_20170103", "d_2016", atau "20170103"
    const timeKeys = Object.keys(row)
        .filter(k => /^d_/i.test(k.trim()) || /^\d{8}$/.test(k.trim()))
        .sort();

    if (timeSeriesChart) {
        timeSeriesChart.data.labels = timeKeys.map(k => k.trim().replace(/^d_/i, ''));
        timeSeriesChart.data.datasets[0].data = timeKeys.map(k => parseInSARValue(row[k]));
        timeSeriesChart.data.datasets[0].label = `Deformasi ${pointId} (mm)`;
        timeSeriesChart.update();
    }

    if (scatterChart) {
        scatterChart.data.datasets[0].data = timeKeys.map((key, index) => ({
            x: index + 1,
            y: parseInSARValue(row[key])
        }));
        scatterChart.update();
    }
}

// =========================================================
// 6. RENDER MARKER DI PETA
// =========================================================
let pointIndex = [];          // daftar titik untuk pencarian terdekat
let selectedMarker = null;    // penanda kecil titik yang dipilih

function renderDashboardData(data) {
    const totalPointsElem = document.getElementById('total-points');
    const avgVelocityElem = document.getElementById('avg-velocity');

    if (totalPointsElem) totalPointsElem.innerText = data.length;
    if (avgVelocityElem && data.length > 0) {
        const avgVel = data.reduce((acc, cur) => acc + getVel(cur), 0) / data.length;
        avgVelocityElem.innerText = `${avgVel.toFixed(1)} mm/thn`;
    }

    // Tidak ada marker yang digambar, hanya index data untuk klik
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
// 7. SORTING
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

    // Penanda kecil sementara supaya terlihat titik mana yang dipilih
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
Papa.parse('data/asc_timeseries.csv', {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: function (results) {
        rawCSVData = results.data;

        // Debug: lihat struktur CSV di Console (F12)
        console.log('Jumlah baris:', rawCSVData.length);
        if (rawCSVData.length > 0) {
            console.log('Nama kolom:', Object.keys(rawCSVData[0]));
            console.log('Baris pertama:', rawCSVData[0]);
        }
        if (results.errors.length) console.warn('Parse errors:', results.errors);

        const currentSort = sortSelect ? sortSelect.value : 'none';
        const displayData = getSortedData(rawCSVData, currentSort);

        renderDashboardData(displayData);

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

fetch('data/UD.tif')
    .then(r => r.arrayBuffer())
    .then(buf => parseGeoraster(buf))
    .then(georaster => {
        const min = georaster.mins[0], max = georaster.maxs[0];
        const absMax = Math.max(Math.abs(min), Math.abs(max));

        const tifLayer = new GeoRasterLayer({
            georaster,
            opacity: 0.7,
            resolution: 256,
            pixelValuesToColorFn: values => {
                const v = values[0];
                if (v === null || isNaN(v) || v === georaster.noDataValue) return null;
                const t = (v + absMax) / (2 * absMax);          // 0..1
                // biru (turun) - putih - merah (naik); balik jika perlu
                const r = Math.round(255 * Math.min(1, t * 2));
                const b = Math.round(255 * Math.min(1, (1 - t) * 2));
                const g = Math.round(255 * (1 - Math.abs(t - 0.5) * 2));
                return `rgb(${r},${g},${b})`;
            }
        });
        tifLayer.addTo(map);
        tifLayer.bringToBack();
    })
    .catch(err => console.error('Gagal memuat TIF:', err));