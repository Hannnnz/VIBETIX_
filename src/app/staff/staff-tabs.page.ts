import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-staff-tabs',
  templateUrl: './staff-tabs.page.html',
  styleUrls: ['./staff-tabs.page.scss'],
  standalone: false,
})
export class StaffTabsPage {
  constructor(
    private auth: AuthService,
    private router: Router
  ) {}

  /**
   * Staff must be part of the company before using the app
   * (MS Teams-style). Un-joined staff always land on /staff/join.
   */
  ionViewWillEnter(): void {
    this.enforceJoin();
  }

  ionViewDidEnter(): void {
    this.enforceJoin();
  }

  private enforceJoin(): void {
    if (this.auth.getSession()?.role === 'staff' && !this.auth.isStaffJoined()) {
      this.router.navigate(['/staff/join'], { replaceUrl: true });
    }
  }
}
