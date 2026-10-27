package app.torsher.androidtv

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Экран оболочки до витрины */
sealed interface ShellScreen {
    data class Address(val input: String, val error: String? = null) : ShellScreen
    data class Connecting(val base: String) : ShellScreen
    data class Outdated(val version: String) : ShellScreen
}

// Цвета из @torsher/tokens
private object Palette {
    val bg = Color(0xFF0B0D12)
    val surface = Color(0xFF161A22)
    val text = Color(0xFFF2F4F8)
    val muted = Color(0xFF9AA3B2)
    val dim = Color(0xFF6B7383)
    val accent = Color(0xFFE8B84A)
    val accentInk = Color(0xFF231800)
    val glass = Color(0x1AF2F4F8)
    val focus = Color.White
    val bad = Color(0xFFFF7A7A)
}

private val Onest = FontFamily(
    Font(R.font.onest, FontWeight.Normal),
    Font(R.font.onest, FontWeight.SemiBold),
)

// Макет витрины рисуется на 1920 px, экран ТВ — 960 dp: 1 px макета = 0,5 dp
private fun u(px: Int) = (px / 2f).dp
private fun fontU(px: Int) = (px / 2f).sp

private fun textStyle(px: Int, color: Color, weight: FontWeight = FontWeight.Normal) =
    TextStyle(fontFamily = Onest, fontSize = fontU(px), color = color, fontWeight = weight)

@Composable
fun ShellApp(
    screen: ShellScreen,
    onConnect: (String) -> Unit,
    onChangeAddress: () -> Unit,
    onContinueOutdated: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Palette.bg),
        contentAlignment = Alignment.Center,
    ) {
        Column(Modifier.width(u(960))) {
            Brand()
            BasicText(
                stringResource(R.string.shell_tagline),
                Modifier.padding(top = u(16), bottom = u(64)),
                style = textStyle(36, Palette.muted),
            )
            when (screen) {
                is ShellScreen.Address -> AddressForm(screen, onConnect)
                is ShellScreen.Connecting -> Connecting(screen.base, onChangeAddress)
                is ShellScreen.Outdated -> Outdated(screen.version, onContinueOutdated)
            }
        }
    }
}

@Composable
private fun Brand() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(
            painterResource(R.drawable.brand_mark),
            contentDescription = null,
            Modifier.size(u(64)),
        )
        Spacer(Modifier.width(u(16)))
        BasicText("Torsher", style = textStyle(56, Palette.accent, FontWeight.SemiBold))
    }
}

@Composable
private fun AddressForm(screen: ShellScreen.Address, onConnect: (String) -> Unit) {
    var value by remember(screen.input) {
        mutableStateOf(TextFieldValue(screen.input, TextRange(screen.input.length)))
    }
    val field = remember { FocusRequester() }
    val button = remember { FocusRequester() }
    val fieldInteraction = remember { MutableInteractionSource() }
    val fieldFocused by fieldInteraction.collectIsFocusedAsState()
    val submit = { onConnect(value.text) }

    BasicText(
        stringResource(R.string.shell_address_label),
        Modifier.padding(bottom = u(16)),
        style = textStyle(24, Palette.muted),
    )
    BasicTextField(
        value = value,
        onValueChange = { value = it },
        modifier = Modifier
            .fillMaxWidth()
            .height(u(96))
            .focusRequester(field)
            .background(Palette.surface, RoundedCornerShape(u(20)))
            .border(
                u(4),
                if (fieldFocused) Palette.focus else Color.Transparent,
                RoundedCornerShape(u(20)),
            )
            .padding(horizontal = u(32)),
        textStyle = textStyle(36, Palette.text),
        singleLine = true,
        cursorBrush = SolidColor(Palette.accent),
        interactionSource = fieldInteraction,
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None,
            autoCorrectEnabled = false,
            keyboardType = KeyboardType.Uri,
            imeAction = ImeAction.Go,
        ),
        keyboardActions = KeyboardActions(onGo = { submit() }),
        decorationBox = { inner ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                if (value.text.isEmpty()) {
                    BasicText("192.168.1.10:8080", style = textStyle(36, Palette.dim))
                }
                inner()
            }
        },
    )
    BasicText(
        stringResource(R.string.shell_address_hint),
        Modifier.padding(top = u(16)),
        style = textStyle(24, Palette.dim),
    )
    screen.error?.let {
        BasicText(it, Modifier.padding(top = u(24)), style = textStyle(28, Palette.bad))
    }
    ShellButton(
        stringResource(R.string.shell_connect),
        primary = true,
        modifier = Modifier.focusRequester(button),
        onClick = submit,
    )

    // Адрес уже есть — проще повторить: фокус на кнопке. В поле фокус сразу
    // открыл бы системную клавиатуру, и она закрыла бы кнопку
    LaunchedEffect(screen) {
        if (screen.input.isNotEmpty()) button.requestFocus()
        else field.requestFocus()
    }
}

@Composable
private fun Connecting(base: String, onChangeAddress: () -> Unit) {
    val change = remember { FocusRequester() }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Spinner()
        Spacer(Modifier.width(u(24)))
        BasicText(
            stringResource(R.string.shell_connecting, displayAddress(base)),
            style = textStyle(36, Palette.text),
        )
    }
    ShellButton(
        stringResource(R.string.shell_change_address),
        primary = false,
        modifier = Modifier.focusRequester(change),
        onClick = onChangeAddress,
    )

    LaunchedEffect(base) { change.requestFocus() }
}

@Composable
private fun Outdated(version: String, onContinue: () -> Unit) {
    val button = remember { FocusRequester() }

    BasicText(
        stringResource(R.string.shell_webview_outdated, version),
        style = textStyle(36, Palette.text),
    )
    ShellButton(
        stringResource(R.string.shell_continue_anyway),
        primary = false,
        modifier = Modifier.focusRequester(button),
        onClick = onContinue,
    )

    LaunchedEffect(Unit) { button.requestFocus() }
}

@Composable
private fun ShellButton(
    label: String,
    primary: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val scale by animateFloatAsState(
        if (focused) 1.06f else 1f,
        tween(160),
        label = "focus",
    )
    // Фон не primary-кнопки в фокусе белый, как фокус-язык витрины
    val background = when {
        primary -> Palette.accent
        focused -> Palette.focus
        else -> Palette.glass
    }
    val color = when {
        primary -> Palette.accentInk
        focused -> Palette.bg
        else -> Palette.text
    }

    Box(
        modifier
            .padding(top = u(48))
            .scale(scale)
            .height(u(84))
            .background(background, RoundedCornerShape(u(16)))
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = u(30)),
        contentAlignment = Alignment.Center,
    ) {
        BasicText(label, style = textStyle(28, color, FontWeight.SemiBold))
    }
}

@Composable
private fun Spinner() {
    val rotation by rememberInfiniteTransition(label = "spinner").animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart),
        label = "rotation",
    )

    Canvas(Modifier.size(u(48))) {
        val stroke = u(6).toPx()
        drawArc(
            Palette.glass,
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            style = Stroke(stroke),
        )
        drawArc(
            Palette.accent,
            startAngle = rotation,
            sweepAngle = 90f,
            useCenter = false,
            style = Stroke(stroke, cap = StrokeCap.Round),
        )
    }
}
