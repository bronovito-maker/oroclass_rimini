<?php
session_start();

// Security Check
if (!isset($_SESSION['loggedin']) || $_SESSION['loggedin'] !== true) {
    header('Location: login.php');
    exit;
}

// Config
$json_file = '../data/articoli.json';
$upload_dir = '../uploads/';
$allowed_types = ['image/jpeg', 'image/png', 'image/webp'];

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

// Handle POST actions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $items = get_items($json_file);

    // --- ADD / UPDATE LOGIC ---
    if (isset($_POST['action']) && ($_POST['action'] === 'add' || $_POST['action'] === 'update')) {
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
                        // finfo_close($finfo); // Deprecated in PHP 8.1+

                        if (in_array($mime, $allowed_types)) {
                            $ext = pathinfo($_FILES['images']['name'][$i], PATHINFO_EXTENSION);
                            $filename = 'img_' . time() . '_' . $i . '_' . bin2hex(random_bytes(3)) . '.' . $ext;
                            $target = $upload_dir . $filename;

                            if (move_uploaded_file($_FILES['images']['tmp_name'][$i], $target)) {
                                $uploaded_images[] = 'uploads/' . $filename;
                            }
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

                        // Append new images to existing ones? Or replace?
                        // Standard logic: If new files uploaded, append them (if we want to keep old)
                        // OR replace logic? "Permetti di mantenere le immagini vecchie se non ne vengono caricate di nuove"
                        // But usually users might want to add 1 more photo.
                        // Let's implement: Append new uploads. If user wants to delete old ones, we'd need a delete-single-image feature.
                        // For simplicity in this iteration: If new images uploaded, we MERGE arrays.
                        // Wait, user might want to REPLACE.
                        // For now let's just MERGE if new files exist. To "Empty" gallery user would delete item.

                        // Ensure 'images' key exists
                        if (!isset($item['images']))
                            $item['images'] = [];
                        if (isset($item['image'])) {
                            // Migrate old single image to array style if needed on the fly
                            if (!in_array($item['image'], $item['images']))
                                $item['images'][] = $item['image'];
                            unset($item['image']);
                        }

                        // --- HANDLE IMAGE DELETION ---
                        if (isset($_POST['delete_images']) && is_array($_POST['delete_images'])) {
                            foreach ($_POST['delete_images'] as $del_img) {
                                // Security check: Ensure we are only deleting files related to this item? 
                                // Or just check if they exist in the array.
                                if (($key = array_search($del_img, $item['images'])) !== false) {
                                    unset($item['images'][$key]);
                                    // Remove file from server
                                    $path = '../' . $del_img;
                                    if (file_exists($path)) {
                                        unlink($path);
                                    }
                                }
                            }
                            // Re-index array
                            $item['images'] = array_values($item['images']);
                        }

                        // Merge logic:
                        // If user uploads NEW images, we prefer them showing up first.
                        // ALSO per request: "eliminiamo il placeholder e lasciamo la foto al primo posto"
                        // So if we have new uploads, we should remove any 'placehold.co' from existing $item['images']
                        if (!empty($uploaded_images)) {
                            // Filter out placeholders from existing
                            $item['images'] = array_filter($item['images'], function ($img) {
                                return strpos($img, 'placehold.co') === false;
                            });

                            // Merge new on top? Or append? usually append, but if we want "foto al primo posto"...
                            // Let's prepend new uploads so they become the main cover.
                            $item['images'] = array_merge($uploaded_images, $item['images']);

                            // Slice to max 4
                            $item['images'] = array_slice($item['images'], 0, 4);
                        }

                        $found = true;
                        $success = "Articolo aggiornato!";
                        break;
                    }
                }
                unset($item); // Break reference
            } else {
                // --- CREATE NEW ---
                $new_item = [
                    'id' => time(),
                    'title' => htmlspecialchars($title),
                    'description' => htmlspecialchars($desc),
                    'price' => htmlspecialchars($price),
                    'images' => $uploaded_images
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
}

$current_items = get_items($json_file);
?>
<!DOCTYPE html>
<html lang="it">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OroClass Admin</title>
    <link rel="stylesheet" href="style.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        /* Small inline tweaks for gallery */
        .admin-gallery {
            display: flex;
            gap: 5px;
        }

        .admin-gallery img {
            width: 40px;
            height: 40px;
            object-fit: cover;
            border-radius: 4px;
            border: 1px solid #333;
        }

        .edit-btn {
            background: #E1C16E;
            color: #000;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            font-weight: bold;
            cursor: pointer;
            margin-right: 5px;
            font-size: 0.8rem;
        }
    </style>
</head>

<body>

    <header class="admin-header">
        <div class="logo">
            <h2>OroClass <span style="color: #E1C16E;">Manager</span></h2>
        </div>
        <a href="logout.php" class="logout-link">Esci</a>
    </header>

    <div class="container">

        <?php if (isset($error)): ?>
            <div class="error-msg"><?php echo $error; ?></div>
        <?php endif; ?>
        <?php if (isset($success)): ?>
            <div class="success-msg"><?php echo $success; ?></div>
        <?php endif; ?>

        <!-- ADD/EDIT FORM -->
        <div class="card">
            <h3 id="form-title">Aggiungi Articolo</h3>
            <form method="POST" enctype="multipart/form-data" id="main-form">
                <input type="hidden" name="action" value="add" id="form-action">
                <input type="hidden" name="edit_id" value="" id="edit-id">

                <div class="form-group">
                    <input type="text" name="title" id="inp-title" placeholder="Titolo (es. Rolex Submariner)" required>
                </div>

                <div class="form-group">
                    <input type="text" name="price" id="inp-price" placeholder="Prezzo (es. € 14.500)" required>
                </div>

                <div class="form-group">
                    <textarea name="description" id="inp-desc" placeholder="Descrizione breve..." rows="3"
                        required></textarea>
                </div>

                <div class="form-group">
                    <label style="color: #94A3B8; display: block; margin-bottom: 0.5rem; font-size: 0.9rem;">Foto
                        Articolo (Max 4):</label>
                    <!-- Custom File Upload -->
                    <div class="custom-file-input">
                        <label for="file-upload" class="file-label">
                            <span id="file-btn-text">Scegli Immagini</span>
                        </label>
                        <!-- name="images[]" for multiple -->
                        <input id="file-upload" type="file" name="images[]" accept="image/*" multiple
                            onchange="updateFileName(this)">
                        <span id="file-chosen" style="color: #94A3B8; font-size: 0.9rem; margin-left: 10px;">Nessun file
                            selezionato</span>
                    </div>

                    <!-- PREVIEW / MANAGE EXISTING IMAGES -->
                    <div id="current-images-container" style="display: none; margin-top: 15px;">
                        <p style="color: #94A3B8; font-size: 0.9rem; margin-bottom: 5px;">Foto Attuali (Seleziona per
                            eliminare):</p>
                        <div id="current-images-grid" style="display: flex; gap: 10px; flex-wrap: wrap;"></div>
                    </div>
                </div>

                <div style="display: flex; gap: 10px; align-items: center;">
                    <button type="submit" class="btn-primary" id="submit-btn" style="flex: 1;">Pubblica
                        Articolo</button>
                    <button type="button" id="cancel-btn"
                        style="display: none; background: transparent; border: 1px solid #666; color: #ccc; padding: 12px; border-radius: 6px; cursor: pointer;"
                        onclick="resetForm()">Annulla</button>
                </div>
            </form>
        </div>

        <!-- ITEM LIST -->
        <div class="card">
            <h3>Articoli in Vetrina (<?php echo count($current_items); ?>)</h3>

            <?php if (empty($current_items)): ?>
                <p style="color: #94A3B8; text-align: center;">Nessun articolo presente.</p>
            <?php else: ?>
                <div class="item-list">
                    <?php foreach ($current_items as $item): ?>
                        <div class="item-row">
                            <!-- GALLERY PREVIEW -->
                            <div class="admin-gallery">
                                <?php
                                $imgs = $item['images'] ?? (isset($item['image']) ? [$item['image']] : []);
                                if (empty($imgs)) {
                                    echo '<div style="width:40px;height:40px;background:#333;border-radius:4px;"></div>';
                                } else {
                                    $first = true;
                                    foreach ($imgs as $img) {
                                        if (!$first) {
                                            // Show only first image + indicator maybe? Or show all small?
                                            // Per request: "una piccola galleria"
                                            echo '<img src="../' . htmlspecialchars($img) . '">';
                                        } else {
                                            echo '<img src="../' . htmlspecialchars($img) . '">';
                                            $first = false;
                                        }
                                        if (count($imgs) > 3)
                                            break; // Limit preview
                                    }
                                }
                                ?>
                            </div>

                            <div class="item-details" style="padding-left: 1rem;">
                                <div class="item-title"><?php echo htmlspecialchars($item['title']); ?></div>
                                <div class="item-price"><?php echo htmlspecialchars($item['price']); ?></div>
                                <div class="item-desc"><?php echo htmlspecialchars($item['description']); ?></div>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 5px;">
                                <button type="button" class="edit-btn" onclick='editItem(<?php echo json_encode($item); ?>)'>
                                    Modifica
                                </button>

                                <form method="POST"
                                    onsubmit="return confirm('Sei sicuro di voler eliminare questo articolo?');">
                                    <input type="hidden" name="action" value="delete">
                                    <input type="hidden" name="id" value="<?php echo $item['id']; ?>">
                                    <button type="submit" class="btn-delete" style="width: 100%;">Elimina</button>
                                </form>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>

    </div>

    <script>
        function updateFileName(input) {
            const fileChosen = document.getElementById('file-chosen');
            if (input.files.length > 0) {
                fileChosen.textContent = input.files.length + ' file selezionati';
                fileChosen.style.color = '#E1C16E';
            } else {
                fileChosen.textContent = 'Nessun file selezionato';
                fileChosen.style.color = '#94A3B8';
            }
        }

        function editItem(item) {
            // Populate form
            document.getElementById('form-title').textContent = 'Modifica Articolo';
            document.getElementById('form-action').value = 'update';
            document.getElementById('edit-id').value = item.id;

            document.getElementById('inp-title').value = item.title;
            document.getElementById('inp-price').value = item.price;
            document.getElementById('inp-desc').value = item.description;

            document.getElementById('submit-btn').textContent = 'Aggiorna Articolo';
            document.getElementById('cancel-btn').style.display = 'block';
            document.getElementById('file-chosen').textContent = 'Lascia vuoto per mantenere le foto attuali';

            // Populate Current Images for Deletion
            const container = document.getElementById('current-images-container');
            const grid = document.getElementById('current-images-grid');
            grid.innerHTML = ''; // Clear prev

            let images = item.images || (item.image ? [item.image] : []);
            
            if (images.length > 0) {
                container.style.display = 'block';
                images.forEach(img => {
                    // Create wrapper
                    const div = document.createElement('div');
                    div.style.position = 'relative';
                    div.style.width = '80px';
                    div.style.height = '80px';
                    
                    // Img
                    const imgEl = document.createElement('img');
                    imgEl.src = '../' + img;
                    imgEl.style.width = '100%';
                    imgEl.style.height = '100%';
                    imgEl.style.objectFit = 'cover';
                    imgEl.style.borderRadius = '4px';
                    imgEl.style.border = '1px solid #333';
                    
                    // Checkbox Overlay
                    const label = document.createElement('label');
                    label.title = "Elimina foto";
                    label.style.position = 'absolute';
                    label.style.top = '-5px';
                    label.style.right = '-5px';
                    label.style.background = 'red';
                    label.style.color = 'white';
                    label.style.borderRadius = '50%';
                    label.style.width = '20px';
                    label.style.height = '20px';
                    label.style.display = 'flex';
                    label.style.alignItems = 'center';
                    label.style.justifyContent = 'center';
                    label.style.cursor = 'pointer';
                    label.style.fontSize = '12px';
                    label.style.fontWeight = 'bold';
                    
                    const iconSpan = document.createElement('span');
                    iconSpan.textContent = '✕';

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.name = 'delete_images[]';
                    checkbox.value = img;
                    checkbox.style.display = 'none'; 
                    
                    checkbox.onchange = function() {
                        if (this.checked) {
                            imgEl.style.opacity = '0.3';
                            iconSpan.textContent = '✔'; 
                            label.style.background = 'white';
                            label.style.color = 'red';
                            label.style.border = '1px solid red';
                        } else {
                            imgEl.style.opacity = '1';
                            iconSpan.textContent = '✕';
                            label.style.background = 'red';
                            label.style.color = 'white';
                            label.style.border = 'none';
                        }
                    };

                    label.appendChild(iconSpan);
                    label.appendChild(checkbox);

                    div.appendChild(imgEl);
                    div.appendChild(label);
                    grid.appendChild(div);
                });
            } else {
                container.style.display = 'none';
            }

            // Scroll up
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function resetForm() {
            document.getElementById('form-title').textContent = 'Aggiungi Articolo';
            document.getElementById('form-action').value = 'add';
            document.getElementById('edit-id').value = '';

            document.getElementById('main-form').reset();

            document.getElementById('submit-btn').textContent = 'Pubblica Articolo';
            document.getElementById('cancel-btn').style.display = 'none';
            document.getElementById('file-chosen').textContent = 'Nessun file selezionato';
            
            // Clear images
            document.getElementById('current-images-container').style.display = 'none';
            document.getElementById('current-images-grid').innerHTML = '';
        }
    </script>

</body>

</html>