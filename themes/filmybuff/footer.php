<footer class="site-footer">
	<div class="wrap">
	<div class="site-footer__grid">
		<div class="site-footer__brand">
			<?php fb_lockup( 'lockup--lg lockup--light' ); ?>
			<p><?php echo esc_html( get_theme_mod( 'fb_footer_tagline', 'For people who love the movies. Bollywood, Hollywood and South cinema: releases, trailers, box office and what to watch tonight.' ) ); ?></p>
		</div>
		<?php foreach ( array( 'footer-sections' => __( 'Sections', 'filmybuff' ), 'footer-more' => __( 'More', 'filmybuff' ), 'footer-follow' => __( 'Follow', 'filmybuff' ) ) as $loc => $title ) : ?>
			<div class="widget"><h3 class="widget-title"><?php echo esc_html( $title ); ?></h3>
			<?php if ( has_nav_menu( $loc ) ) { wp_nav_menu( array( 'theme_location' => $loc, 'container' => false, 'depth' => 1 ) ); }
			elseif ( $loc === 'footer-sections' ) { echo '<ul>'; wp_list_categories( array( 'title_li' => '', 'number' => 6 ) ); echo '</ul>'; }
			elseif ( $loc === 'footer-follow' ) { $h = get_theme_mod( 'fb_instagram', 'filmybuff' ); echo '<ul><li><a href="' . esc_url( 'https://instagram.com/' . $h ) . '">Instagram</a></li><li><a href="' . esc_url( 'https://www.youtube.com/@' . $h ) . '">YouTube</a></li><li><a href="' . esc_url( get_bloginfo( 'rss2_url' ) ) . '">RSS</a></li></ul>'; }
			else { echo '<ul>'; wp_list_pages( array( 'title_li' => '', 'number' => 5 ) ); echo '</ul>'; } ?>
			</div>
		<?php endforeach; ?>
	</div>
	<div class="site-footer__bottom">
		<span>© <?php echo esc_html( wp_date( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?>. <?php esc_html_e( 'Every film gets a fair watch.', 'filmybuff' ); ?></span>
		<span class="handle">@<?php echo esc_html( get_theme_mod( 'fb_instagram', 'filmybuff' ) ); ?></span>
		<?php if ( get_privacy_policy_url() ) : ?><a class="legal" href="<?php echo esc_url( get_privacy_policy_url() ); ?>"><?php esc_html_e( 'Privacy policy', 'filmybuff' ); ?></a><?php endif; ?>
	</div>
	</div>
</footer>
</div>
<?php wp_footer(); ?>
</body>
</html>
