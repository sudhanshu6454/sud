<?php
/**
 * Title: FAQ
 * Slug: marketing-junkies/faq
 * Categories: text
 * Keywords: faq, questions, schema
 * Description: Place at the end of an article. Rendered last, after the tags, and emitted as FAQPage schema. autopub adds the same markup automatically.
 *
 * @package marketing-junkies
 */

?>
<!-- wp:group {"tagName":"section","className":"faq","layout":{"type":"default"}} -->
<section class="wp-block-group faq"><!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'Frequently asked', 'marketing-junkies' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:details -->
<details class="wp-block-details"><summary><?php esc_html_e( 'Question readers search for?', 'marketing-junkies' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'One or two sentence answer, from the source.', 'marketing-junkies' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details -->
<details class="wp-block-details"><summary><?php esc_html_e( 'Second question?', 'marketing-junkies' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'Answer.', 'marketing-junkies' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details -->
<details class="wp-block-details"><summary><?php esc_html_e( 'Third question?', 'marketing-junkies' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'Answer.', 'marketing-junkies' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details --></section>
<!-- /wp:group -->
