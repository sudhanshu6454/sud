<?php
/**
 * Campaign archive search prompt.
 *
 * @package marketing-mentalist
 */
?>
<section class="mm-section" style="padding:80px var(--gutter) 88px;display:flex;flex-direction:column;gap:28px">
	<span class="mm-kicker">Campaign archive</span>
	<label for="mm-arc" class="mm-h1" style="max-width:900px;cursor:text;font-size:56px">What are you trying to decode?</label>
	<form role="search" method="get" action="<?php echo esc_url( home_url( '/' ) ); ?>">
		<div class="mm-search-field">
			<input id="mm-arc" type="search" name="s" placeholder="Search campaigns, brands, agencies or ideas…">
			<button type="submit" aria-label="Search">→</button>
		</div>
	</form>
	<div class="mm-popular">
		<span class="mm-meta" style="margin-right:8px">Popular</span>
		<?php foreach ( array( 'Funny', 'Emotional', 'AI', 'IPL', 'Celebrity', 'OOH', 'Gen Z', 'Luxury', 'Moment marketing' ) as $s ) : ?>
			<a class="mm-tag" href="<?php echo esc_url( add_query_arg( 's', rawurlencode( $s ), home_url( '/' ) ) ); ?>"><?php echo esc_html( $s ); ?></a>
		<?php endforeach; ?>
	</div>
</section>
