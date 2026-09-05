<?php
/**
 * Trending ticker.
 *
 * @package marketing-mentalist
 */

$mm_trending = get_posts( array( 'post_type' => array( 'mm_campaign', 'mm_breakdown', 'post' ), 'posts_per_page' => 8, 'meta_key' => 'mm_is_trending', 'meta_value' => '1', 'no_found_rows' => true ) );
if ( count( $mm_trending ) < 4 ) {
	$mm_trending = mm_latest_of( array( 'mm_campaign', 'mm_breakdown', 'post' ), 8 );
}
if ( ! $mm_trending ) {
	return;
}
?>
<div class="mm-ticker">
	<span class="mm-ticker-label">Trending <span class="mm-ticker-dot"></span></span>
	<div class="mm-ticker-track">
		<div class="mm-ticker-inner">
			<?php foreach ( array_merge( $mm_trending, $mm_trending ) as $t ) : ?>
				<a href="<?php echo esc_url( get_permalink( $t ) ); ?>"><?php echo esc_html( get_the_title( $t ) ); ?></a>
			<?php endforeach; ?>
		</div>
	</div>
</div>
