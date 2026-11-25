package local.review;

import java.nio.CharBuffer;
import java.nio.charset.*;
import java.util.regex.Pattern;

/**
 * Assess the body after removing export footers. The verbatim text remains available in the
 * preview.
 */
final class PageText {
  private static final Pattern FOOTER =
      Pattern.compile(
          "(?im)^\\h*[-–—]?\\h*(?:第\\h*)?\\d+\\h*/\\h*\\d+\\h*页\\h*[-–—]?\\h*(?:《[^\\r"
              + "\\n"
              + "]*》)?\\h*$");
  private static final Pattern PAGE_NUMBER =
      Pattern.compile("(?im)^\\h*[-–—]?\\h*(?:第\\h*)?\\d+\\h*(?:页|/\\h*\\d+)?\\h*[-–—]?\\h*$");
  private static final Pattern OCR_SPACE = Pattern.compile("(?<=\\p{IsHan})\\h+(?=\\p{IsHan})");
  private static final Charset GB = Charset.forName("GB2312");

  static String body(String text) {
    return PAGE_NUMBER.matcher(FOOTER.matcher(text).replaceAll("")).replaceAll("").strip();
  }

  static String fromOcr(String text) {
    return body(OCR_SPACE.matcher(text).replaceAll(""));
  }

  static boolean suspect(String text) {
    String body = body(text);
    int letters = 0, han = 0, rare = 0, broken = 0;
    var encoder =
        GB.newEncoder()
            .onUnmappableCharacter(CodingErrorAction.REPLACE)
            .onMalformedInput(CodingErrorAction.REPLACE);
    for (int i = 0; i < body.length(); ) {
      int cp = body.codePointAt(i);
      i += Character.charCount(cp);
      if (Character.isLetter(cp)) letters++;
      if (Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN) {
        han++;
        // Level-one GB2312 covers the common simplified Chinese characters.
        var bytes = CharBuffer.wrap(Character.toChars(cp));
        try {
          var encoded = encoder.encode(bytes);
          int lead = encoded.get() & 255;
          if (lead < 0xb0 || lead > 0xd7) rare++;
        } catch (CharacterCodingException e) {
          rare++;
        }
      }
      if (cp == 0xfffd
          || Character.getType(cp) == Character.PRIVATE_USE
          || (Character.isISOControl(cp) && !Character.isWhitespace(cp))) broken++;
    }
    return letters < 3
        || (letters < 12 && FOOTER.matcher(text).find())
        || broken > 0
        || (han >= 6 && rare * 3 > han);
  }
}
