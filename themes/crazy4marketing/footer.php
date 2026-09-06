<footer class="site-footer">
	<div class="site-footer__grid">
		<div class="site-footer__brand">
			<img src="<?php echo esc_url( get_template_directory_uri() . '/assets/lockup_dark.png' ); ?>" alt="crazy4 marketing." width="220">
			<p><?php echo esc_html( get_theme_mod( 'c4_footer_tagline', 'An Instagram publication for marketing & brand culture. News, viral campaigns, and the sharpest takes — every day.' ) ); ?></p>
		</div>
		<?php foreach ( array( 'footer-sections' => __( 'Sections', 'crazy4marketing' ), 'footer-more' => __( 'More', 'crazy4marketing' ), 'footer-follow' => __( 'Follow', 'crazy4marketing' ) ) as $loc => $title ) : ?>
			<div class="widget"><h3 class="widget-title"><?php echo esc_html( $title ); ?></h3>
			<?php if ( has_nav_menu( $loc ) ) { wp_nav_menu( array( 'theme_location' => $loc, 'container' => false, 'depth' => 1 ) ); } elseif ( $loc === 'footer-sections' ) { echo '<ul>'; wp_list_categories( array( 'title_li' => '', 'number' => 4 ) ); echo '</ul>'; } elseif ( $loc === 'footer-follow' ) { $h = get_theme_mod( 'c4_instagram', 'crazy4marketing' ); echo '<ul><li><a href="' . esc_url( 'https://instagram.com/' . $h ) . '">Instagram</a></li><li><a href="' . esc_url( get_bloginfo( 'rss2_url' ) ) . '">RSS</a></li></ul>'; } else { echo '<ul>'; wp_list_pages( array( 'title_li' => '', 'number' => 4 ) ); echo '</ul>'; } ?>
			</div>
		<?php endforeach; ?>
	</div>
	<div class="site-footer__bottom">
		<span>© <?php echo esc_html( wp_date( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?>. <?php esc_html_e( 'Facts before opinions. Always.', 'crazy4marketing' ); ?></span>
		<span class="handle">@<?php echo esc_html( get_theme_mod( 'c4_instagram', 'crazy4marketing' ) ); ?></span>
	</div>
</footer>
</div>
<?php wp_footer(); ?>
</body>
</html>
