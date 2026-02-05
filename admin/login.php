<?php
session_start();

// Configuration
$password_hash = '$2y$12$Om2jRZ2falOhKKXIF56yyenpC6cVcGIiMbKpz9HQjrwnpEHjFXJb6'; // 'OroClass2026'
$valid_email = 'shop@oroclass.net';

// Handle Login
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = $_POST['email'] ?? '';
    $password = $_POST['password'] ?? '';

    if ($email === $valid_email && password_verify($password, $password_hash)) {
        session_regenerate_id(true); // Harden session
        $_SESSION['loggedin'] = true;
        header('Location: ./index.php');
        exit;
    } else {
        $error = "Credenziali non valide.";
    }
}
?>
<!DOCTYPE html>
<html lang="it">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OroClass Admin - Login</title>
    <link rel="stylesheet" href="style.css">
    <!-- Font for better styling -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
</head>

<body class="login-body">
    <div class="login-page-wrapper">
        <div class="login-card">
            <div class="login-header">
                <span class="login-logo"><span class="text-gold">ORO</span><span>CLASS</span> <span
                        class="text-gold">RIMINI</span></span>
                <p class="login-subtitle">MANAGER ACCESS</p>
            </div>

            <?php if (isset($error)): ?>
                <div class="error-msg"><?php echo htmlspecialchars($error); ?></div>
            <?php endif; ?>

            <form method="POST" action="">
                <div class="form-group">
                    <label class="form-label">Email Amministratore</label>
                    <input type="email" name="email" placeholder="email@esempio.it" required autofocus>
                </div>
                <div class="form-group">
                    <label class="form-label">Password</label>
                    <input type="password" name="password" placeholder="••••••••" required>
                </div>
                <button type="submit" class="btn-primary">Entra nel Gestore</button>
            </form>
        </div>
    </div>
</body>

</html>