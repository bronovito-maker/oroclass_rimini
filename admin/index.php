<?php
session_start();

// Security Check
if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    header('Location: ./login.php');
    exit;
}

// Config
$json_file = '../data/articoli.json';
$upload_dir = '../uploads/';
$allowed_types = ['image/jpeg', 'image/png', 'image/webp'];

// CSRF Protection: Generate token if not exists
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

// Helper: Read JSON
function get_items($file)
{
    if (!file_exists($file))
        return [];
    $data = file_get_contents($file);
    return json_decode($data, true) ?? [];
}

// Helper: Write JSON
function save_items($file, $items)
{
    file_put_contents($file, json_encode($items, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

// Helper: Resize and Optimize Image (Always saves as WebP for performance)
function resize_image($source_path, $target_path, $mime_type, $max_width = 1000, $quality = 75)
{
    // Increase memory limit for processing large mobile images
    @ini_set('memory_limit', '512M');

    // Get original dimensions
    list($width, $height) = getimagesize($source_path);
    if (!$width || !$height)
        return false;

    // Create source image
    switch ($mime_type) {
        case 'image/jpeg':
            $src = imagecreatefromjpeg($source_path);
            // Handle Orientation for mobile photos
            if (function_exists('exif_read_data')) {
                $exif = @exif_read_data($source_path);
                if ($exif && isset($exif['Orientation'])) {
                    switch ($exif['Orientation']) {
                        case 3:
                            $src = imagerotate($src, 180, 0);
                            break;
                        case 6:
                            $src = imagerotate($src, -90, 0);
                            // Switch dimensions if rotated
                            $tmp = $width;
                            $width = $height;
                            $height = $tmp;
                            break;
                        case 8:
                            $src = imagerotate($src, 90, 0);
                            // Switch dimensions if rotated
                            $tmp = $width;
                            $width = $height;
                            $height = $tmp;
                            break;
                    }
                }
            }
            break;
        case 'image/png':
            $src = imagecreatefrompng($source_path);
            break;
        case 'image/webp':
            $src = imagecreatefromwebp($source_path);
            break;
        default:
            return false;
    }

    if (!$src)
        return false;

    // Calculate new dimensions after potential rotation
    $ratio = $width / $height;
    if ($width > $max_width) {
        $new_width = $max_width;
        $new_height = floor($max_width / $ratio);
    } else {
        $new_width = $width;
        $new_height = $height;
    }

    // Create destination image
    $dst = imagecreatetruecolor($new_width, $new_height);

    // Transparency support (always good to have for WebP)
    imagealphablending($dst, false);
    imagesavealpha($dst, true);

    // Resize
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $new_width, $new_height, $width, $height);

    // Save as WebP (force format for consistency and speed)
    $result = imagewebp($dst, $target_path, $quality);

    return $result;
}

// Handle POST actions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Validate CSRF token
    if (!isset($_POST['csrf_token']) || $_POST['csrf_token'] !== $_SESSION['csrf_token']) {
        die('Errore di sicurezza: Richiesta non autorizzata (CSRF).');
    }

    $items = get_items($json_file);

    // --- CONCURRENCY CHECK ---
    // If we're editing/adding, check if the file was modified since the form was loaded
    if (isset($_POST['file_mtime']) && (int) $_POST['file_mtime'] > 0) {
        clearstatcache();
        if ((int) $_POST['file_mtime'] < filemtime($json_file)) {
            $error = "Attenzione: I dati sono stati modificati (forse in un'altra scheda). Per evitare di perdere le modifiche altrui, ricarica la pagina prima di salvare.";
        }
    }

    // --- ADD / UPDATE LOGIC ---
    if (!isset($error) && isset($_POST['action']) && ($_POST['action'] === 'add' || $_POST['action'] === 'update')) {
        $title = trim($_POST['title']);
        $price = trim($_POST['price']);
        $desc = trim($_POST['description']);
        $edit_id = isset($_POST['edit_id']) ? (int) $_POST['edit_id'] : null;

        $uploaded_images = [];

        // Handle Image Uploads (Multiple)
        if (isset($_FILES['images']) && !empty($_FILES['images']['name'][0])) {
            $count = count($_FILES['images']['name']);
            // Limit to 4 images
            if ($count > 4 && $_POST['action'] === 'add') {
                $error = "Puoi caricare massimo 4 foto.";
            } else {
                for ($i = 0; $i < $count; $i++) {
                    if ($i >= 4)
                        break; // Hard limit

                    if ($_FILES['images']['error'][$i] === 0) {
                        $finfo = finfo_open(FILEINFO_MIME_TYPE);
                        $mime = finfo_file($finfo, $_FILES['images']['tmp_name'][$i]);

                        if (in_array($mime, $allowed_types)) {
                            // Always use .webp extension since we convert to it
                            $filename = 'img_' . time() . '_' . $i . '_' . bin2hex(random_bytes(3)) . '.webp';
                            $target = $upload_dir . $filename;

                            // Process and resize image instead of just moving it
                            if (resize_image($_FILES['images']['tmp_name'][$i], $target, $mime)) {
                                $uploaded_images[] = 'uploads/' . $filename;
                            } else {
                                $error = "Errore durante l'elaborazione di una foto. Potrebbe essere in un formato corrotto o troppo pesante.";
                            }
                        } else {
                            $error = "Formato file non supportato. Usa JPG, PNG o WebP.";
                        }
                    } else {
                        // Handle specific upload errors
                        switch ($_FILES['images']['error'][$i]) {
                            case UPLOAD_ERR_INI_SIZE:
                            case UPLOAD_ERR_FORM_SIZE:
                                $error = "Una delle foto è troppo pesante (limite server superato). Prova a ridurla prima di caricarla.";
                                break;
                            case UPLOAD_ERR_PARTIAL:
                                $error = "Il caricamento è stato interrotto. Riprova.";
                                break;
                            default:
                                $error = "Errore nel caricamento del file (Codice: " . $_FILES['images']['error'][$i] . ").";
                        }
                    }
                }
            }
        }

        if (!isset($error)) {
            if ($_POST['action'] === 'update' && $edit_id) {
                // --- UPDATE EXISTING ---
                $found = false;
                foreach ($items as &$item) {
                    if ($item['id'] === $edit_id) {
                        $item['title'] = htmlspecialchars($title);
                        $item['price'] = htmlspecialchars($price);
                        $item['description'] = htmlspecialchars($desc);

                        // Ensure 'images' key exists
                        if (!isset($item['images']))
                            $item['images'] = [];
                        if (isset($item['image'])) {
                            if (!in_array($item['image'], $item['images']))
                                $item['images'][] = $item['image'];
                            unset($item['image']);
                        }

                        // --- 1. SET ORDER FROM STATE (if provided) ---
                        if (isset($_POST['existing_order']) && !empty($_POST['existing_order'])) {
                            $new_order = explode(',', $_POST['existing_order']);
                            // Refresh item images with the sent order
                            $item['images'] = $new_order;
                        }

                        // --- 2. HANDLE IMAGE DELETION ---
                        if (isset($_POST['delete_images']) && is_array($_POST['delete_images'])) {
                            foreach ($_POST['delete_images'] as $del_img) {
                                if (($key = array_search($del_img, $item['images'])) !== false) {
                                    unset($item['images'][$key]);
                                    $path = '../' . $del_img;
                                    if (file_exists($path)) {
                                        unlink($path);
                                    }
                                }
                            }
                            $item['images'] = array_values($item['images']);
                        }

                        // --- 3. MERGE NEW UPLOADS ---
                        if (!empty($uploaded_images)) {
                            $item['images'] = array_filter($item['images'], function ($img) {
                                return strpos($img, 'placehold.co') === false;
                            });
                            // Prepend new uploads
                            $item['images'] = array_merge($uploaded_images, $item['images']);
                            $item['images'] = array_slice($item['images'], 0, 4);
                        }

                        $found = true;
                        $success = "Articolo aggiornato!";
                        break;
                    }
                }
                unset($item);
            } else {
                // --- CREATE NEW ---
                $new_item = [
                    'id' => time(),
                    'title' => htmlspecialchars($title),
                    'description' => htmlspecialchars($desc),
                    'price' => htmlspecialchars($price),
                    'images' => $uploaded_images,
                    'sold' => false
                ];
                array_unshift($items, $new_item);
                $success = "Articolo pubblicato!";
            }
            save_items($json_file, $items);
        }
    }

    // --- DELETE ITEM ---
    if (isset($_POST['action']) && $_POST['action'] === 'delete') {
        $id_to_delete = (int) $_POST['id'];
        $index_to_remove = -1;

        foreach ($items as $idx => $item) {
            if ($item['id'] === $id_to_delete) {
                $index_to_remove = $idx;

                // Delete ALL images
                $imgs = [];
                if (isset($item['images']) && is_array($item['images']))
                    $imgs = $item['images'];
                if (isset($item['image']))
                    $imgs[] = $item['image']; // Backward compat

                foreach ($imgs as $img_rel) {
                    $path = '../' . $img_rel;
                    if (file_exists($path))
                        unlink($path);
                }
                break;
            }
        }

        if ($index_to_remove > -1) {
            array_splice($items, $index_to_remove, 1);
            save_items($json_file, $items);
            $success = "Articolo eliminato e foto rimosse.";
        }
    }

    // --- TOGGLE SOLD STATUS ---
    if (isset($_POST['action']) && $_POST['action'] === 'toggle_sold') {
        $id_to_toggle = (int) $_POST['id'];
        $found = false;
        foreach ($items as &$item) {
            if ($item['id'] === $id_to_toggle) {
                $item['sold'] = !($item['sold'] ?? false);
                $found = true;
                $success = $item['sold'] ? "Articolo segnato come VENDUTO." : "Articolo ripristinato in vetrina.";
                break;
            }
        }
        if ($found) {
            save_items($json_file, $items);
        }
    }
}

$current_items = get_items($json_file);
$json_mtime = file_exists($json_file) ? filemtime($json_file) : time();
?>
<!DOCTYPE html>
<html lang="it">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OroClass Admin</title>
    <link rel="stylesheet" href="style.css?v=<?php echo time(); ?>">
</head>

<body>

    <header class="admin-header">
        <a href="index.php" class="logo" aria-label="OroClass Manager Home">
            <span class="text-gold">ORO</span><span>CLASS</span> <span class="text-gold">RIMINI</span>
        </a>
        <div style="display: flex; gap: 20px; align-items: center;">
            <a href="login.php?logout=1" class="logout-link">Esci</a>
        </div>
    </header>

    <div class="welcome-bar">
        <div class="admin-container" style="margin: 0 auto; padding: 15px 1.5rem;">
            <span class="welcome-text">Benvenuta, <span class="text-gold">Sabrina</span></span>
        </div>
    </div>

    <div class="admin-container">

        <?php if (isset($error)): ?>
            <div class="error-msg"><?php echo $error; ?></div>
        <?php endif; ?>
        <?php if (isset($success)): ?>
            <div class="success-msg"><?php echo $success; ?></div>
        <?php endif; ?>

        <!-- ADD/EDIT FORM -->
        <div class="admin-card">
            <h3 id="form-title">Gestione Articoli</h3>
            <form method="POST" enctype="multipart/form-data" id="main-form">
                <input type="hidden" name="action" value="add" id="form-action">
                <input type="hidden" name="edit_id" value="" id="edit-id">
                <input type="hidden" name="csrf_token" value="<?php echo $_SESSION['csrf_token']; ?>">
                <input type="hidden" name="file_mtime" value="<?php echo $json_mtime; ?>" id="file-mtime">
                <input type="hidden" name="existing_order" value="" id="existing-order">

                <div class="form-group">
                    <label class="form-label">Titolo Articolo</label>
                    <input type="text" name="title" id="inp-title" placeholder="Es. Rolex Submariner Date" required>
                </div>

                <div class="form-group">
                    <label class="form-label">Prezzo (€)</label>
                    <div class="price-input-wrapper">
                        <input type="number" name="price" id="inp-price" placeholder="Esempio: 14500" step="1" required>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">Descrizione del Prodotto</label>
                    <textarea name="description" id="inp-desc" placeholder="Descrivi il prodotto in dettaglio..."
                        rows="4" required></textarea>
                </div>

                <div class="form-group">
                    <label class="form-label">Foto del Prodotto (Aggiungi fino a 4 immagini)</label>

                    <div class="drop-zone" id="drop-zone">
                        <div class="drop-zone-text">
                            <span style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;">📸</span>
                            Trascina qui le foto o <strong>clicca per selezionare</strong>
                        </div>
                        <input id="file-upload" type="file" name="images[]" accept="image/*" multiple
                            style="display: none;">
                    </div>

                    <div id="new-previews" class="preview-grid"></div>

                    <!-- PREVIEW / MANAGE EXISTING IMAGES -->
                    <div id="current-images-container"
                        style="display: none; margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 1rem;">
                        <p style="color: #94A3B8; font-size: 0.9rem; margin-bottom: 10px;">Foto già caricate (X per
                            rimuovere):</p>
                        <div id="current-images-grid" style="display: flex; gap: 10px; flex-wrap: wrap;"></div>
                    </div>
                </div>

                <div style="display: flex; gap: 10px; align-items: center;">
                    <button type="submit" class="btn-primary" id="submit-btn" style="flex: 1;">
                        <span class="loader" id="submit-loader"></span>
                        <span id="submit-text">Pubblica Articolo</span>
                    </button>
                    <button type="button" id="cancel-btn"
                        style="display: none; background: transparent; border: 1px solid #ef4444; color: #ef4444; padding: 12px; border-radius: 6px; cursor: pointer;"
                        onclick="resetForm()">Annulla</button>
                </div>
            </form>
        </div>

        <!-- ITEM LIST -->
        <div class="admin-card">
            <h3 style="display: flex; justify-content: space-between; align-items: center;">
                <span>Articoli in Vetrina (<?php echo count($current_items); ?>)</span>
            </h3>

            <?php if (empty($current_items)): ?>
                <p style="color: #94A3B8; text-align: center; padding: 2rem;">Nessun articolo presente.</p>
            <?php else: ?>
                <div class="item-list">
                    <?php foreach ($current_items as $item): ?>
                        <div class="item-row">
                            <!-- GALLERY PREVIEW -->
                            <div class="admin-gallery">
                                <?php
                                $imgs = $item['images'] ?? (isset($item['image']) ? [$item['image']] : []);
                                if (empty($imgs)) {
                                    echo '<div style="width:100%;height:100%;background:#111;display:flex;align-items:center;justify-content:center;color:#333;">📷</div>';
                                } else {
                                    // Show only first image as cover
                                    echo '<img src="../' . htmlspecialchars($imgs[0]) . '" alt="Cover">';
                                    if (count($imgs) > 1) {
                                        echo '<div style="position:absolute;bottom:5px;right:5px;background:rgba(0,0,0,0.6);color:white;font-size:10px;padding:2px 6px;border-radius:4px;">+' . (count($imgs) - 1) . '</div>';
                                    }
                                    // SOLD BADGE
                                    if ($item['sold'] ?? false) {
                                        echo '<div style="position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:10;">';
                                        echo '<span style="background:#EF4444;color:white;font-size:10px;font-weight:900;padding:4px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:1px;">Venduto</span>';
                                        echo '</div>';
                                    }
                                }
                                ?>
                            </div>

                            <div class="item-details">
                                <div class="item-title"><?php echo htmlspecialchars($item['title']); ?></div>
                                <div class="item-price"><?php
                                $numeric_price = (int) preg_replace('/[^0-9]/', '', $item['price']);
                                if ($numeric_price === 0) {
                                    echo "Prezzo su richiesta";
                                } else {
                                    echo "€ " . number_format($numeric_price, 0, ',', '.');
                                }
                                ?></div>
                                <div class="item-desc"><?php echo htmlspecialchars($item['description']); ?></div>
                            </div>

                            <div class="actions-cell">
                                <button type="button" class="icon-btn" title="Modifica"
                                    onclick='editItem(<?php echo json_encode($item); ?>)'>
                                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2"
                                        fill="none" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                    </svg>
                                    <span>Modifica</span>
                                </button>

                                <form method="POST" style="margin:0;">
                                    <input type="hidden" name="action" value="toggle_sold">
                                    <input type="hidden" name="id" value="<?php echo $item['id']; ?>">
                                    <input type="hidden" name="csrf_token" value="<?php echo $_SESSION['csrf_token']; ?>">
                                    <button type="submit" class="icon-btn" title="<?php echo ($item['sold'] ?? false) ? 'Ripristina' : 'Segna come Venduto'; ?>">
                                        <?php if ($item['sold'] ?? false): ?>
                                            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
                                                <path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0"></path>
                                                <path d="M9 12l2 2 4-4"></path>
                                            </svg>
                                            <span>Ripristina</span>
                                        <?php else: ?>
                                            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
                                                <circle cx="12" cy="12" r="10"></circle>
                                                <line x1="15" y1="9" x2="9" y2="15"></line>
                                                <line x1="9" y1="9" x2="15" y2="15"></line>
                                            </svg>
                                            <span>Venduto</span>
                                        <?php endif; ?>
                                    </button>
                                </form>

                                <form method="POST"
                                    onsubmit="return confirm('Sei sicuro di voler eliminare questo articolo?');">
                                    <input type="hidden" name="action" value="delete">
                                    <input type="hidden" name="id" value="<?php echo $item['id']; ?>">
                                    <input type="hidden" name="csrf_token" value="<?php echo $_SESSION['csrf_token']; ?>">
                                    <button type="submit" class="icon-btn delete" title="Elimina">
                                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2"
                                            fill="none" stroke-linecap="round" stroke-linejoin="round">
                                            <polyline points="3 6 5 6 21 6"></polyline>
                                            <path
                                                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2">
                                            </path>
                                            <line x1="10" y1="11" x2="10" y2="17"></line>
                                            <line x1="14" y1="11" x2="14" y2="17"></line>
                                        </svg>
                                        <span>Elimina</span>
                                    </button>
                                </form>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>

    </div>

    <script>
        // Drag & Drop & Preview Logic
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-upload');
        const previewGrid = document.getElementById('new-previews');

        // This will store our compressed files ready for upload
        let compressedBlobs = [];

        dropZone.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, e => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
        });

        dropZone.addEventListener('drop', e => {
            const dt = e.dataTransfer;
            processFiles(dt.files);
        });

        fileInput.addEventListener('change', function () {
            processFiles(this.files);
        });

        async function processFiles(files) {
            previewGrid.innerHTML = '';
            compressedBlobs = []; // Reset queue

            const fileList = Array.from(files).slice(0, 4);

            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];

                // Show temporary loading preview
                const placeholder = document.createElement('div');
                placeholder.className = 'preview-item';
                placeholder.style.opacity = '0.5';
                placeholder.innerHTML = '<div class="mini-loader"></div>';
                previewGrid.appendChild(placeholder);

                try {
                    const compressed = await compressImage(file);
                    compressedBlobs.push({
                        blob: compressed,
                        name: file.name.replace(/\.[^/.]+$/, "") + ".webp"
                    });

                    // Show final preview
                    const url = URL.createObjectURL(compressed);
                    placeholder.style.opacity = '1';
                    placeholder.innerHTML = `<img src="${url}">`;
                } catch (err) {
                    console.error("Compression error:", err);
                    placeholder.innerHTML = '❌';
                }
            }
        }

        function compressImage(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = event => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX_WIDTH = 1200;
                        let width = img.width;
                        let height = img.height;

                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }

                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        canvas.toBlob(blob => {
                            if (blob) resolve(blob);
                            else reject(new Error("Canvas toBlob failed"));
                        }, 'image/webp', 0.75);
                    };
                    img.onerror = reject;
                };
                reader.onerror = reject;
            });
        }

        // Form Submission Interception
        document.getElementById('main-form').addEventListener('submit', async function (e) {
            // If we have compressed blobs and they haven't been sent yet
            if (compressedBlobs.length > 0) {
                e.preventDefault(); // Stop normal submission

                const btn = document.getElementById('submit-btn');
                const loader = document.getElementById('submit-loader');
                const text = document.getElementById('submit-text');

                btn.disabled = true;
                loader.style.display = 'inline-block';
                text.textContent = 'Invio in corso...';

                const formData = new FormData(this);

                // Remove the original empty/heavy file field
                formData.delete('images[]');

                // Append our compressed blobs
                compressedBlobs.forEach(item => {
                    formData.append('images[]', item.blob, item.name);
                });

                // Send via Fetch
                try {
                    const response = await fetch('', {
                        method: 'POST',
                        body: formData
                    });

                    if (response.ok) {
                        // Success! Refresh the page to show the result
                        window.location.reload();
                    } else {
                        alert("Errore durante il salvataggio. Riprova.");
                        btn.disabled = false;
                        loader.style.display = 'none';
                        text.textContent = 'Riprova';
                    }
                } catch (err) {
                    console.error("Upload error:", err);
                    alert("Errore di connessione.");
                    btn.disabled = false;
                    loader.style.display = 'none';
                }
            } else {
                // Regular submission if no new images are being added
                const btn = document.getElementById('submit-btn');
                const loader = document.getElementById('submit-loader');
                const text = document.getElementById('submit-text');

                btn.disabled = true;
                loader.style.display = 'inline-block';
                text.textContent = 'Salvataggio...';
            }
        });

        function editItem(item) {
            resetForm(); // Clear any new previews

            document.getElementById('form-title').textContent = 'Modifica Articolo';
            document.getElementById('form-action').value = 'update';
            document.getElementById('edit-id').value = item.id;

            document.getElementById('inp-title').value = item.title;
            // Extract numbers from price if it's stored with currency symbols (backward compat)
            let rawPrice = item.price.replace(/[^0-9]/g, '');
            document.getElementById('inp-price').value = rawPrice;
            document.getElementById('inp-desc').value = item.description;

            document.getElementById('submit-btn').querySelector('#submit-text').textContent = 'Aggiorna Articolo';
            document.getElementById('cancel-btn').style.display = 'block';

            const container = document.getElementById('current-images-container');
            const grid = document.getElementById('current-images-grid');
            grid.innerHTML = '';

            let images = item.images || (item.image ? [item.image] : []);
            renderManageImages(images);

            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function renderManageImages(images) {
            const container = document.getElementById('current-images-container');
            const grid = document.getElementById('current-images-grid');
            const orderInput = document.getElementById('existing-order');

            grid.innerHTML = '';
            orderInput.value = images.join(',');

            if (images.length > 0) {
                container.style.display = 'block';
                images.forEach((img, index) => {
                    const div = document.createElement('div');
                    div.style.position = 'relative';
                    div.style.width = '100px';
                    div.style.height = '120px'; // Extra space for order buttons
                    div.style.display = 'flex';
                    div.style.flexDirection = 'column';
                    div.style.gap = '5px';

                    const imgWrapper = document.createElement('div');
                    imgWrapper.style.position = 'relative';
                    imgWrapper.style.width = '100%';
                    imgWrapper.style.height = '100px';

                    const imgEl = document.createElement('img');
                    imgEl.src = '../' + img;
                    imgEl.style.width = '100%';
                    imgEl.style.height = '100%';
                    imgEl.style.objectFit = 'cover';
                    imgEl.style.borderRadius = '8px';
                    imgEl.style.border = '2px solid #2A3441';

                    // DELETE LABEL
                    const label = document.createElement('label');
                    label.style.position = 'absolute';
                    label.style.top = '-5px';
                    label.style.right = '-5px';
                    label.style.background = '#ef4444';
                    label.style.color = 'white';
                    label.style.borderRadius = '50%';
                    label.style.width = '24px';
                    label.style.height = '24px';
                    label.style.display = 'flex';
                    label.style.alignItems = 'center';
                    label.style.justifyContent = 'center';
                    label.style.cursor = 'pointer';
                    label.style.fontSize = '12px';
                    label.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
                    label.style.zIndex = '5';

                    const iconSpan = document.createElement('span');
                    iconSpan.textContent = '✕';

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.name = 'delete_images[]';
                    checkbox.value = img;
                    checkbox.style.display = 'none';

                    checkbox.onchange = function () {
                        if (this.checked) {
                            imgEl.style.opacity = '0.3';
                            imgEl.style.borderColor = '#ef4444';
                            iconSpan.textContent = '✔';
                            label.style.background = '#22c55e';
                        } else {
                            imgEl.style.opacity = '1';
                            imgEl.style.borderColor = '#2A3441';
                            iconSpan.textContent = '✕';
                            label.style.background = '#ef4444';
                        }
                    };

                    label.appendChild(iconSpan);
                    label.appendChild(checkbox);
                    imgWrapper.appendChild(imgEl);
                    imgWrapper.appendChild(label);

                    // REORDER BUTTONS
                    const controls = document.createElement('div');
                    controls.style.display = 'flex';
                    controls.style.justifyContent = 'center';
                    controls.style.gap = '10px';

                    if (index > 0) {
                        const upBtn = document.createElement('button');
                        upBtn.type = 'button';
                        upBtn.innerHTML = '←';
                        upBtn.className = 'icon-btn';
                        upBtn.style.padding = '2px 8px';
                        upBtn.style.fontSize = '12px';
                        upBtn.onclick = () => moveImage(images, index, -1);
                        controls.appendChild(upBtn);
                    }

                    if (index < images.length - 1) {
                        const downBtn = document.createElement('button');
                        downBtn.type = 'button';
                        downBtn.innerHTML = '→';
                        downBtn.className = 'icon-btn';
                        downBtn.style.padding = '2px 8px';
                        downBtn.style.fontSize = '12px';
                        downBtn.onclick = () => moveImage(images, index, 1);
                        controls.appendChild(downBtn);
                    }

                    div.appendChild(imgWrapper);
                    div.appendChild(controls);
                    grid.appendChild(div);
                });
            } else {
                container.style.display = 'none';
            }
        }

        function moveImage(images, index, direction) {
            const newIndex = index + direction;
            if (newIndex >= 0 && newIndex < images.length) {
                const temp = images[index];
                images[index] = images[newIndex];
                images[newIndex] = temp;
                renderManageImages(images);
            }
        }

        function resetForm() {
            document.getElementById('form-title').textContent = 'Aggiungi Articolo';
            document.getElementById('form-action').value = 'add';
            document.getElementById('edit-id').value = '';
            document.getElementById('main-form').reset();

            const submitBtn = document.getElementById('submit-btn');
            submitBtn.disabled = false;
            submitBtn.querySelector('#submit-loader').style.display = 'none';
            submitBtn.querySelector('#submit-text').textContent = 'Pubblica Articolo';

            document.getElementById('cancel-btn').style.display = 'none';
            document.getElementById('new-previews').innerHTML = '';
            document.getElementById('current-images-container').style.display = 'none';
            document.getElementById('current-images-grid').innerHTML = '';
        }
    </script>

</body>

</html>